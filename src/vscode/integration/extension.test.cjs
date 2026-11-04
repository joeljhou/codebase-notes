const assert = require("node:assert/strict");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

async function waitUntil(predicate, message, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

describe("Codebase Notes Extension Host", () => {
  let extension;
  let api;
  let state;

  before(async () => {
    extension = vscode.extensions.getExtension(
      "joeljhou.codebase-notes-vscode",
    );
    assert.ok(extension, "扩展应出现在 Extension Host");
    api = await extension.activate();
    assert.ok(api.manager);
    assert.ok(api.treeView);
    state = api.manager.allStates()[0];
    assert.ok(state, "测试 workspace 应有一个 state");
  });

  it("注册命令并且不在纯展示时创建配置", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("codebaseNotes.editNote"));
    assert.ok(commands.includes("codebaseNotes.setNoteStyle"));
    assert.ok(commands.includes("codebaseNotes.relinkPrefix"));
    assert.ok(commands.includes("codebaseNotes.revealInNotes"));
    assert.ok(commands.includes("codebaseNotes.revealInExplorer"));
    assert.equal(state.kind, "missing");

    const roots = await api.treeProvider.getChildren();
    assert.equal(roots.length, 1);
    const entries = await api.treeProvider.getChildren(roots[0]);
    assert.deepEqual(
      entries.map((entry) => String(entry.label)),
      ["src", "README.md"],
    );
  });

  it("配置写入后 Tree 与 Decoration 读取同一快照", async () => {
    const created = await state.repository.create(state.configPath);
    state.accept(created);
    assert.ok(state.snapshot);

    const written = await state.repository.setNote(
      state.snapshot,
      "src/App.ts",
      { text: "应用入口", style: "core" },
    );
    state.accept(written);
    api.manager.notifyStateChanged();

    const roots = await api.treeProvider.getChildren();
    assert.equal(roots.length, 1);
    const entries = await api.treeProvider.getChildren(roots[0]);
    const src = entries.find((entry) => entry.label === "src");
    assert.ok(src);
    const files = await api.treeProvider.getChildren(src);
    const app = files.find((entry) => entry.label === "App.ts");
    assert.ok(app);
    assert.equal(app.description, "应用入口");
    assert.equal(app.contextValue, "codebaseNotes.entryWithNote");
    assert.equal(app.command.command, "vscode.open");
    assert.equal((await api.treeProvider.getParent(app)).label, "src");

    const resolved = await api.treeProvider.itemForUri(
      vscode.Uri.file(path.join(state.folder.uri.fsPath, "src", "App.ts")),
    );
    assert.equal(resolved.description, "应用入口");

    const sourceUri = vscode.Uri.file(
      path.join(state.folder.uri.fsPath, "src", "App.ts"),
    );
    assert.equal(app.targetUri.toString(), sourceUri.toString());
    assert.equal(app.resourceUri.scheme, "codebase-notes");
    assert.equal(
      await api.decorationProvider.provideFileDecoration(sourceUri),
      undefined,
      "系统资源管理器不应收到备注颜色",
    );

    const decoration = await api.decorationProvider.provideFileDecoration(
      app.resourceUri,
    );
    assert.equal(decoration.badge, undefined);
    assert.equal(decoration.tooltip, "应用入口");
    assert.equal(
      decoration.color.id,
      "codebaseNotes.noteStyle.coreForeground",
    );

    let treeRefreshCount = 0;
    const decorationChanges = [];
    const treeSubscription = api.treeProvider.onDidChangeTreeData(() => {
      treeRefreshCount += 1;
    });
    const decorationSubscription =
      api.decorationProvider.onDidChangeFileDecorations((changed) => {
        decorationChanges.push(changed);
      });

    api.manager.setNoteStylePreview(state, "src/App.ts", "extension");
    assert.equal(treeRefreshCount, 0, "样式预览不应刷新整棵资源树");
    assert.deepEqual(
      decorationChanges.map((changed) => changed?.toString()),
      [app.resourceUri.toString()],
    );
    const preview = await api.decorationProvider.provideFileDecoration(
      app.resourceUri,
    );
    assert.equal(
      preview.color.id,
      "codebaseNotes.noteStyle.extensionForeground",
    );
    api.manager.setNoteStylePreview(state, "src/App.ts", undefined);
    assert.equal(treeRefreshCount, 0, "取消样式预览不应刷新整棵资源树");
    assert.deepEqual(
      decorationChanges.map((changed) => changed?.toString()),
      [app.resourceUri.toString(), app.resourceUri.toString()],
    );
    treeSubscription.dispose();
    decorationSubscription.dispose();

    await vscode.commands.executeCommand(
      "codebaseNotes.revealInNotes",
      sourceUri,
    );
    assert.equal(
      api.treeView.selection[0]?.targetUri.toString(),
      sourceUri.toString(),
    );
    await vscode.commands.executeCommand(
      "codebaseNotes.revealInExplorer",
      api.treeView.selection[0],
    );
  });

  it("活动编辑器变化会在代码备注树中展开并选中文件", async () => {
    const readmeUri = vscode.Uri.file(
      path.join(state.folder.uri.fsPath, "README.md"),
    );
    const sourceUri = vscode.Uri.file(
      path.join(state.folder.uri.fsPath, "src", "App.ts"),
    );

    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(readmeUri),
    );
    await waitUntil(
      () =>
        api.treeView.selection[0]?.targetUri.toString() === readmeUri.toString(),
      "打开 README.md 后代码备注树未自动选中",
    );

    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(sourceUri),
    );
    await waitUntil(
      () =>
        api.treeView.selection[0]?.targetUri.toString() === sourceUri.toString(),
      "打开嵌套文件后代码备注树未展开并自动选中",
    );
  });

  it("workspace.applyEdit rename 会迁移 note key", async () => {
    const oldUri = vscode.Uri.file(
      path.join(state.folder.uri.fsPath, "src", "App.ts"),
    );
    const newUri = vscode.Uri.file(
      path.join(state.folder.uri.fsPath, "src", "Main.ts"),
    );
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(oldUri, newUri);
    assert.equal(await vscode.workspace.applyEdit(edit), true);

    await waitUntil(
      () => state.snapshot?.config.notes["src/Main.ts"] !== undefined,
      "rename 后配置未迁移",
    );
    assert.equal(state.snapshot.config.notes["src/App.ts"], undefined);
    const stored = JSON.parse(await readFile(state.configPath, "utf8"));
    assert.equal(stored.notes.src["Main.ts"]._text, "应用入口");
    assert.equal(stored.notes.src["Main.ts"]._meta.style, "core");
  });

  it("外部改配置会触发 watcher 刷新", async () => {
    const current = JSON.parse(await readFile(state.configPath, "utf8"));
    assert.equal(current.version, 3);
    current.notes["README.md"] = "项目说明";
    current.notes.missing = { "Ghost.ts": "待重新关联" };
    await writeFile(state.configPath, JSON.stringify(current, null, 2) + "\n");

    await waitUntil(
      () => state.snapshot?.config.notes["README.md"]?.text === "项目说明",
      "watcher 未刷新外部修改",
    );

    const [root] = await api.treeProvider.getChildren();
    const entries = await api.treeProvider.getChildren(root);
    const readme = entries.find((entry) => entry.label === "README.md");
    assert.equal(readme.description, "项目说明");
    const missingGroup = entries.find(
      (entry) => entry.contextValue === "codebaseNotes.missingGroup",
    );
    assert.ok(missingGroup);
    const missing = await api.treeProvider.getChildren(missingGroup);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].label, "missing/Ghost.ts");
    assert.equal(missing[0].description, "待重新关联");
  });

  it("文件新增会刷新完整备注资源管理器", async () => {
    let changed = false;
    const subscription = api.treeProvider.onDidChangeTreeData(() => {
      changed = true;
    });
    await writeFile(
      path.join(state.folder.uri.fsPath, "NewFile.ts"),
      "export const created = true;\n",
    );
    await waitUntil(() => changed, "新增文件后 Tree 未刷新");
    subscription.dispose();

    const [root] = await api.treeProvider.getChildren();
    const entries = await api.treeProvider.getChildren(root);
    assert.ok(entries.some((entry) => entry.label === "NewFile.ts"));
  });

  it("最新配置保存保留元数据且父备注删除不影响文件展示", async () => {
    const fileKey = state.noteForKey("src/Main.ts") ? "src/Main.ts" : "src/App.ts";
    let result = await state.repository.commit(state.snapshot, {
      [fileKey]: { text: "应用入口", style: "core" },
      src: { text: "源代码目录", style: "focus", future: [null, true] },
    });
    state.accept(result);
    const text = await readFile(state.configPath, "utf8");
    await state.refresh();
    assert.equal(await readFile(state.configPath, "utf8"), text);
    assert.equal(state.noteForKey("constructor"), undefined);
    assert.equal(state.noteForKey("__proto__"), undefined);
    api.manager.notifyStateChanged();
    const stored = JSON.parse(await readFile(state.configPath, "utf8"));
    assert.equal(stored.version, 3);
    assert.deepEqual(stored.notes.src._meta, { style: "focus", future: [null, true] });
    const roots = await api.treeProvider.getChildren();
    const src = (await api.treeProvider.getChildren(roots[0])).find((entry) => entry.label === "src");
    assert.equal(src.description, "源代码目录");
    const removed = await state.repository.setNote(state.snapshot, "src", null);
    state.accept(removed);
    api.manager.notifyStateChanged();
    assert.equal(removed.kind, "committed");
    assert.equal(state.noteForKey(fileKey).text, "应用入口");
    assert.equal(JSON.parse(await readFile(state.configPath, "utf8")).notes.src._text, undefined);
  });

  it("保存时压紧叶子备注并合并节点自身的文字与样式", async () => {
    for (const [key, note] of [
      [".", { text: "项目说明", style: "core" }],
      ["src", { text: "源代码", style: "focus" }],
      ["src/Main.ts", { text: "应用入口\n第二行", style: "important" }],
    ]) {
      const result = await state.repository.setNote(state.snapshot, key, note);
      assert.equal(result.kind, "committed");
      state.accept(result);
    }
    const text = await readFile(state.configPath, "utf8");
    assert.ok(text.includes('    "_text": "项目说明", "_meta": { "style": "core" },\n'));
    assert.ok(text.includes('      "_text": "源代码", "_meta": { "style": "focus" },\n'));
    assert.ok(text.includes('      "Main.ts": { "_text": "应用入口\\n第二行", "_meta": { "style": "important" } }\n'));
    const stored = JSON.parse(text);
    assert.equal(stored.notes.src["Main.ts"]._text, "应用入口\n第二行");
    await state.refresh();
    assert.equal(state.noteForKey("src/Main.ts").text, "应用入口\n第二行");
    const repeated = await state.repository.setNote(state.snapshot, ".", state.noteForKey("."));
    assert.equal(repeated.kind, "no-change");
    state.accept(repeated);
    assert.equal(await readFile(state.configPath, "utf8"), text);
  });

  it("压缩目录配置支持链接、未保存文档定位和文件增删自动维护", async () => {
    const folder = state.folder.uri;
    const chain = "compact/cn/geekyspace/app";
    const key = `${chain}/integration`;
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, key));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, chain, "unit"));
    state.accept(await state.repository.setNote(state.snapshot, key, { text: "集成测试", style: "focus" }));
    await state.refresh();
    assert.ok(JSON.parse(await readFile(state.configPath, "utf8")).notes[chain]);
    const configUri = vscode.Uri.file(state.configPath);
    const document = await vscode.workspace.openTextDocument(configUri);
    let links = await vscode.commands.executeCommand("vscode.executeLinkProvider", configUri);
    const link = links.find((item) => document.getText(item.range) === chain);
    assert.ok(link, "压缩 key 应有定位链接");
    assert.equal(link.target.scheme, "command");
    assert.equal(link.target.path, "codebaseNotes.revealInExplorer");
    const [argument] = JSON.parse(decodeURIComponent(link.target.query));
    const target = vscode.Uri.revive ? vscode.Uri.revive(argument) : vscode.Uri.from(argument);
    assert.equal(target.fsPath, path.join(folder.fsPath, chain));
    assert.ok(link.tooltip.includes(target.fsPath));
    const openBefore = vscode.window.visibleTextEditors.map((item) => item.document.uri.toString());
    await vscode.commands.executeCommand(link.target.path, argument);
    assert.deepEqual(vscode.window.visibleTextEditors.map((item) => item.document.uri.toString()), openBefore);
    const editor = await vscode.window.showTextDocument(document);
    const before = document.getText();
    const unsaved = JSON.parse(before);
    unsaved.notes["compact/cn/geekyspace"] = unsaved.notes[chain];
    delete unsaved.notes[chain];
    await editor.edit((builder) => builder.replace(new vscode.Range(document.positionAt(0), document.positionAt(before.length)), JSON.stringify(unsaved)));
    links = await vscode.commands.executeCommand("vscode.executeLinkProvider", configUri);
    assert.ok(links.some((item) => document.getText(item.range) === "compact/cn/geekyspace"), "链接使用未保存内容");
    const sibling = vscode.Uri.joinPath(folder, "compact/cn/README.md");
    await vscode.workspace.fs.writeFile(sibling, Buffer.from("branch"));
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(await readFile(state.configPath, "utf8"), before, "dirty 时不得覆盖用户编辑");
    await vscode.commands.executeCommand("workbench.action.files.revert");
    assert.equal(document.isDirty, false);
    await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), " "));
    await document.save();
    await waitUntil(async () => {
      const notes = JSON.parse(await readFile(state.configPath, "utf8")).notes;
      return !!notes["compact/cn"]?.["geekyspace/app"];
    }, "保存后应补做 dirty 期间推迟的维护");
    await vscode.workspace.fs.delete(sibling);
    await waitUntil(async () => !!JSON.parse(await readFile(state.configPath, "utf8")).notes[chain], "删除分支后应重新压缩");
    const newSibling = vscode.Uri.joinPath(folder, "compact/cn/new.txt");
    await vscode.workspace.fs.writeFile(newSibling, Buffer.from("new branch"));
    await waitUntil(async () => !!JSON.parse(await readFile(state.configPath, "utf8")).notes["compact/cn"], "新增未备注文件后应拆开压缩链");
    await vscode.workspace.fs.delete(newSibling);
    await waitUntil(async () => !!JSON.parse(await readFile(state.configPath, "utf8")).notes[chain], "删除新分支后应重新压缩");
    const otherUri = vscode.Uri.joinPath(folder, "other.json");
    await vscode.workspace.fs.writeFile(otherUri, Buffer.from('{"version":3,"notes":{"src":"note"}}'));
    assert.equal((await vscode.commands.executeCommand("vscode.executeLinkProvider", otherUri)).length, 0);
    await vscode.workspace.fs.delete(otherUri);
    await state.refresh();
    state.accept(await state.repository.setNote(state.snapshot, key, null));
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, "compact"), { recursive: true });
    await state.refresh();
  });

  it("配置 Document dirty 状态可被写入前置检查识别", async () => {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(state.configPath),
    );
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit((builder) => {
      builder.insert(new vscode.Position(0, 0), " ");
    });
    assert.equal(state.isConfigDocumentDirty(), true);
    await vscode.commands.executeCommand("workbench.action.files.revert");
  });
});
