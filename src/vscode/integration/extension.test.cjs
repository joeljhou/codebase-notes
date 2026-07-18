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
    assert.ok(api.webviewProvider);
    state = api.manager.allStates()[0];
    assert.ok(state, "测试 workspace 应有一个 state");
  });

  it("注册命令并且不在纯展示时创建配置", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("codebaseNotes.editNote"));
    assert.ok(commands.includes("codebaseNotes.setNoteStyle"));
    assert.ok(commands.includes("codebaseNotes.relinkPrefix"));
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
      { text: "应用入口", style: "success" },
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

    const decoration = await api.decorationProvider.provideFileDecoration(
      vscode.Uri.file(path.join(state.folder.uri.fsPath, "src", "App.ts")),
    );
    assert.equal(decoration.badge, "N");
    assert.equal(decoration.tooltip, "应用入口");
    assert.equal(decoration.color, undefined);

    api.manager.setNoteStylePreview(state, "src/App.ts", "danger");
    const preview = await api.decorationProvider.provideFileDecoration(
      vscode.Uri.file(path.join(state.folder.uri.fsPath, "src", "App.ts")),
    );
    assert.equal(preview.color, undefined);
    api.manager.setNoteStylePreview(state, "src/App.ts", undefined);

    const webRoots = await api.webviewProvider.children();
    const webEntries = await api.webviewProvider.children(webRoots[0].id);
    const webSrc = webEntries.find((entry) => entry.label === "src");
    assert.ok(webSrc);
    const webFiles = await api.webviewProvider.children(webSrc.id);
    const webApp = webFiles.find((entry) => entry.label === "App.ts");
    assert.equal(webApp.label, "App.ts");
    assert.equal(webApp.note, "应用入口");
    assert.equal(webApp.style, "success");
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
  });

  it("外部改配置会触发 watcher 刷新", async () => {
    const current = JSON.parse(await readFile(state.configPath, "utf8"));
    current.notes["README.md"] = { text: "项目说明" };
    current.notes["missing/Ghost.ts"] = { text: "待重新关联" };
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
