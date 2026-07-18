import path from "node:path";
import * as vscode from "vscode";
import type { NoteStyle } from "../core/types.js";
import { NotesWorkspaceManager } from "../platform/workspace-manager.js";
import { resolvedNoteStyle } from "./note-style.js";
import {
  MissingNoteTreeItem,
  MissingNotesGroupTreeItem,
  NoteTargetTreeItem,
  NotesExplorerProvider,
  RootTreeItem,
  WorkspaceEntryTreeItem,
  type NotesTreeItem,
} from "./tree-provider.js";
import { summarizeNote } from "./tree-utils.js";

const VIEW_ID = "codebaseNotes.annotatedFiles";

export interface NotesWebviewNode {
  id: string;
  label: string;
  kind: "root" | "folder" | "file" | "missing-group" | "missing";
  expandable: boolean;
  contextValue: string;
  uri?: string;
  note?: string;
  style?: NoteStyle;
  status?: string;
}

interface WebviewMessage {
  type?: unknown;
  parentId?: unknown;
  id?: unknown;
  action?: unknown;
}

function labelOf(item: vscode.TreeItem): string {
  if (typeof item.label === "string") {
    return item.label;
  }
  return item.label?.label ?? "";
}

function nodeId(item: NotesTreeItem): string {
  return item.id ?? `${item.contextValue ?? "item"}:${labelOf(item)}`;
}

function inputNameError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return vscode.l10n.t("A name is required");
  }
  if (trimmed === "." || trimmed === ".." || /[\\/]/u.test(trimmed)) {
    return vscode.l10n.t("Enter a single file or folder name");
  }
  return undefined;
}

export class NotesWebviewProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  readonly #nodes = new Map<string, NotesTreeItem>();
  readonly #disposables: vscode.Disposable[] = [];
  #view: vscode.WebviewView | undefined;
  #selectedId: string | undefined;
  #focused = false;

  constructor(
    readonly extensionUri: vscode.Uri,
    readonly manager: NotesWorkspaceManager,
    readonly treeProvider: NotesExplorerProvider,
  ) {
    this.#disposables.push(
      treeProvider.onDidChangeTreeData(() => {
        void this.refresh();
      }),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.#view = webviewView;
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    webviewView.webview.options = {
      enableScripts: true,
      enableForms: false,
      localResourceRoots: [mediaRoot],
    };
    webviewView.webview.html = this.#html(webviewView.webview);
    this.#disposables.push(
      webviewView.webview.onDidReceiveMessage((message: unknown) => {
        void this.#handleMessage(message);
      }),
      webviewView.onDidDispose(() => {
        if (this.#view === webviewView) {
          this.#view = undefined;
          this.#nodes.clear();
        }
      }),
    );
  }

  async children(parentId?: string): Promise<NotesWebviewNode[]> {
    const parent = parentId === undefined ? undefined : this.#nodes.get(parentId);
    if (parentId !== undefined && parent === undefined) {
      return [];
    }
    const items = await this.treeProvider.getChildren(parent);
    return items.map((item) => this.#serialize(item));
  }

  async refresh(): Promise<void> {
    this.#nodes.clear();
    if (this.#view === undefined) {
      return;
    }
    const roots = await this.children();
    await this.#view.webview.postMessage({
      type: "reset",
      roots,
      labels: this.#labels(),
    });
  }

  async revealUri(uri: vscode.Uri, select = true): Promise<void> {
    const state = this.manager.stateForUri(uri);
    if (state === undefined || this.#view === undefined) {
      return;
    }
    const key = await state.keyForUri(uri);
    const prefix = state.folder.uri.toString();
    const ids = [`${prefix}::.`];
    if (key !== ".") {
      const parts = key.split("/");
      for (let index = 1; index <= parts.length; index += 1) {
        ids.push(`${prefix}::${parts.slice(0, index).join("/")}`);
      }
    }
    this.#view.show(true);
    await this.#view.webview.postMessage({ type: "reveal", ids, select });
  }

  commandTarget(): NotesTreeItem | vscode.Uri | undefined {
    if (!this.#focused || this.#selectedId === undefined) {
      return undefined;
    }
    const item = this.#nodes.get(this.#selectedId);
    if (item instanceof MissingNoteTreeItem) {
      return item;
    }
    return item?.resourceUri;
  }

  dispose(): void {
    this.#nodes.clear();
    this.#disposables.forEach((disposable) => disposable.dispose());
  }

  #serialize(item: NotesTreeItem): NotesWebviewNode {
    const id = nodeId(item);
    this.#nodes.set(id, item);
    const contextValue = item.contextValue ?? "";
    const expandable =
      item.collapsibleState !== undefined &&
      item.collapsibleState !== vscode.TreeItemCollapsibleState.None;
    const kind: NotesWebviewNode["kind"] =
      item instanceof RootTreeItem
        ? "root"
        : item instanceof MissingNotesGroupTreeItem
          ? "missing-group"
          : item instanceof MissingNoteTreeItem
            ? "missing"
            : item instanceof WorkspaceEntryTreeItem && item.directory
              ? "folder"
              : expandable
                ? "folder"
                : "file";
    const uri = item.resourceUri?.toString();
    const noteTarget = item instanceof NoteTargetTreeItem ? item : undefined;
    const note = noteTarget?.state.noteForKey(noteTarget.noteKey);
    const style =
      noteTarget === undefined || note === undefined
        ? undefined
        : (this.manager.previewedNoteStyle(
            noteTarget.state,
            noteTarget.noteKey,
          ) ?? resolvedNoteStyle(note));
    const description =
      typeof item.description === "string" ? item.description : undefined;
    return {
      id,
      label: labelOf(item),
      kind,
      expandable,
      contextValue,
      ...(uri === undefined ? {} : { uri }),
      ...(note === undefined ? {} : { note: summarizeNote(note.text) }),
      ...(style === undefined ? {} : { style }),
      ...(note === undefined && description !== undefined
        ? { status: description }
        : {}),
    };
  }

  async #handleMessage(raw: unknown): Promise<void> {
    if (typeof raw !== "object" || raw === null) {
      return;
    }
    const message = raw as WebviewMessage;
    if (message.type === "ready") {
      await this.refresh();
      return;
    }
    if (message.type === "focus") {
      this.#focused = true;
      return;
    }
    if (message.type === "blur") {
      this.#focused = false;
      return;
    }
    if (message.type === "select" && typeof message.id === "string") {
      this.#selectedId = message.id;
      return;
    }
    if (message.type === "children" && typeof message.parentId === "string") {
      const nodes = await this.children(message.parentId);
      await this.#view?.webview.postMessage({
        type: "children",
        parentId: message.parentId,
        nodes,
      });
      return;
    }
    if (
      message.type === "action" &&
      typeof message.id === "string" &&
      typeof message.action === "string"
    ) {
      const item = this.#nodes.get(message.id);
      if (item !== undefined) {
        await this.#runAction(message.action, item);
      }
    }
  }

  async #runAction(action: string, item: NotesTreeItem): Promise<void> {
    const uri = item.resourceUri;
    try {
      switch (action) {
        case "open":
          if (uri !== undefined) await this.#open(uri, false);
          break;
        case "openSide":
          if (uri !== undefined) await this.#open(uri, true);
          break;
        case "newFile":
          if (uri !== undefined) await this.#create(uri, false);
          break;
        case "newFolder":
          if (uri !== undefined) await this.#create(uri, true);
          break;
        case "rename":
          if (uri !== undefined) await this.#rename(uri);
          break;
        case "delete":
          if (uri !== undefined) await this.#delete(uri);
          break;
        case "copyPath":
          if (uri !== undefined) await vscode.env.clipboard.writeText(uri.fsPath);
          break;
        case "copyRelativePath":
          if (uri !== undefined) {
            const state = this.manager.stateForUri(uri);
            await vscode.env.clipboard.writeText(
              state === undefined ? uri.fsPath : await state.keyForUri(uri),
            );
          }
          break;
        case "revealExplorer":
          if (uri !== undefined) {
            await vscode.commands.executeCommand("revealInExplorer", uri);
          }
          break;
        case "revealOs":
          if (uri !== undefined) {
            await vscode.commands.executeCommand("revealFileInOS", uri);
          }
          break;
        case "editNote":
          if (uri !== undefined) {
            await vscode.commands.executeCommand("codebaseNotes.editNote", uri);
          }
          break;
        case "setStyle":
          if (uri !== undefined) {
            await vscode.commands.executeCommand(
              "codebaseNotes.setNoteStyle",
              uri,
            );
          }
          break;
        case "clearNote":
          if (uri !== undefined) {
            await vscode.commands.executeCommand("codebaseNotes.removeNote", uri);
          }
          break;
        case "relink":
          await vscode.commands.executeCommand("codebaseNotes.relinkNote", item);
          break;
      }
    } catch (error) {
      await vscode.window.showErrorMessage(
        vscode.l10n.t("File operation failed: {0}", (error as Error).message),
      );
    }
  }

  async #open(uri: vscode.Uri, side: boolean): Promise<void> {
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      await vscode.commands.executeCommand("revealInExplorer", uri);
      return;
    }
    await vscode.window.showTextDocument(uri, {
      preview: true,
      viewColumn: side ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
    });
  }

  async #create(parent: vscode.Uri, directory: boolean): Promise<void> {
    const title = directory
      ? vscode.l10n.t("New Folder")
      : vscode.l10n.t("New File");
    const name = await vscode.window.showInputBox({
      title,
      prompt: vscode.l10n.t("Name"),
      validateInput: inputNameError,
    });
    if (name === undefined) return;
    const target = vscode.Uri.joinPath(parent, name.trim());
    if (directory) {
      await vscode.workspace.fs.createDirectory(target);
    } else {
      await vscode.workspace.fs.writeFile(target, new Uint8Array());
      await this.#open(target, false);
    }
  }

  async #rename(uri: vscode.Uri): Promise<void> {
    const current = path.basename(uri.fsPath);
    const name = await vscode.window.showInputBox({
      title: vscode.l10n.t("Rename"),
      value: current,
      validateInput: inputNameError,
    });
    if (name === undefined || name.trim() === current) return;
    const target = vscode.Uri.joinPath(uri, "..", name.trim());
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(uri, target, { overwrite: false });
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error(vscode.l10n.t("VS Code rejected the rename operation"));
    }
  }

  async #delete(uri: vscode.Uri): Promise<void> {
    const move = vscode.l10n.t("Move to Trash");
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t("Move {0} to the Trash?", path.basename(uri.fsPath)),
      { modal: true },
      move,
    );
    if (answer !== move) return;
    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
  }

  #labels(): Record<string, string> {
    return {
      open: vscode.l10n.t("Open"),
      openSide: vscode.l10n.t("Open to the Side"),
      newFile: vscode.l10n.t("New File"),
      newFolder: vscode.l10n.t("New Folder"),
      rename: vscode.l10n.t("Rename"),
      delete: vscode.l10n.t("Delete"),
      copyPath: vscode.l10n.t("Copy Path"),
      copyRelativePath: vscode.l10n.t("Copy Relative Path"),
      revealExplorer: vscode.l10n.t("Reveal in Explorer"),
      revealOs:
        process.platform === "darwin"
          ? vscode.l10n.t("Reveal in Finder")
          : vscode.l10n.t("Reveal in File Manager"),
      editNote: vscode.l10n.t("Edit Text Note"),
      setStyle: vscode.l10n.t("Set Note Style"),
      clearNote: vscode.l10n.t("Clear Note"),
      relink: vscode.l10n.t("Relink Note"),
      empty: vscode.l10n.t("No files to display"),
    };
  }

  #html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "notes-explorer.css"),
    );
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "notes-explorer.js"),
    );
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
  <link rel="stylesheet" href="${css}">
  <title>Codebase Notes</title>
</head>
<body>
  <div id="tree" class="tree" role="tree" aria-label="Codebase Notes"></div>
  <div id="menu" class="context-menu" role="menu" hidden></div>
  <script src="${script}"></script>
</body>
</html>`;
  }
}

export { VIEW_ID as NOTES_WEBVIEW_VIEW_ID };
