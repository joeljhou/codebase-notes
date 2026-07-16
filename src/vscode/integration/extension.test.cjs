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
      "codebase-notes.codebase-notes-vscode",
    );
    assert.ok(extension, "扩展应出现在 Extension Host");
    api = await extension.activate();
    assert.ok(api.manager);
    state = api.manager.allStates()[0];
    assert.ok(state, "测试 workspace 应有一个 state");
  });

  it("注册命令并且不在纯展示时创建配置", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("codebaseNotes.editNote"));
    assert.ok(commands.includes("codebaseNotes.relinkPrefix"));
    assert.equal(state.kind, "missing");
  });

  it("配置写入后 Tree 与 Decoration 读取同一快照", async () => {
    const created = await state.repository.create(state.configPath);
    state.accept(created);
    assert.ok(state.snapshot);

    const written = await state.repository.setNote(
      state.snapshot,
      "src/App.ts",
      { text: "应用入口" },
    );
    state.accept(written);
    api.manager.notifyStateChanged();

    const roots = await api.treeProvider.getChildren();
    assert.equal(roots.length, 1);
    const notes = await api.treeProvider.getChildren(roots[0]);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].label, "src/App.ts");

    const decoration = await api.decorationProvider.provideFileDecoration(
      vscode.Uri.file(path.join(state.folder.uri.fsPath, "src", "App.ts")),
    );
    assert.equal(decoration.badge, "N");
    assert.equal(decoration.tooltip, "应用入口");
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
    await writeFile(state.configPath, JSON.stringify(current, null, 2) + "\n");

    await waitUntil(
      () => state.snapshot?.config.notes["README.md"]?.text === "项目说明",
      "watcher 未刷新外部修改",
    );
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
