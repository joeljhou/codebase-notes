import path from "node:path";
import * as vscode from "vscode";
import { isValidNoteKey } from "../core/path-policy.js";
import { searchNotes } from "../core/search.js";
import type { Note } from "../core/types.js";
import {
  NotesWorkspaceManager,
  WorkspaceNotesState,
} from "../platform/workspace-manager.js";
import {
  compareTreeEntries,
  shouldExcludePath,
  summarizeNote,
  type FilesExcludePatterns,
} from "./tree-utils.js";
import { notesViewResourceUri } from "./tree-resource-uri.js";

function isDirectory(type: vscode.FileType): boolean {
  return (type & vscode.FileType.Directory) !== 0;
}

function entryLabel(uri: vscode.Uri): string {
  return path.basename(uri.fsPath);
}

export abstract class WorkspaceNodeTreeItem extends vscode.TreeItem {
  constructor(
    readonly state: WorkspaceNotesState,
    readonly entryKey: string,
    readonly targetUri: vscode.Uri,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.id = `${state.folder.uri.toString()}::${entryKey}`;
    this.resourceUri = notesViewResourceUri(targetUri);
  }
}

export abstract class NoteTargetTreeItem extends WorkspaceNodeTreeItem {
  constructor(
    state: WorkspaceNotesState,
    readonly noteKey: string,
    resourceUri: vscode.Uri,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(state, noteKey, resourceUri, label, collapsibleState);
  }

  protected applyNote(note: Note | undefined): void {
    if (note === undefined) {
      return;
    }
    this.description = summarizeNote(note.text);
    this.tooltip = note.text;
  }
}

export class RootTreeItem extends NoteTargetTreeItem {
  constructor(state: WorkspaceNotesState) {
    super(
      state,
      ".",
      state.folder.uri,
      state.folder.name,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    const note = state.noteForKey(".");
    this.contextValue =
      note === undefined ? "codebaseNotes.root" : "codebaseNotes.rootWithNote";
    this.iconPath = new vscode.ThemeIcon("root-folder");
    this.applyNote(note);
    if (state.kind === "diagnostic" && state.diagnostic !== undefined) {
      this.description = state.diagnostic.code;
      this.tooltip = state.diagnostic.message;
    } else if (state.kind === "missing") {
      this.description = vscode.l10n.t("No configuration");
    }
  }
}

export class WorkspaceEntryTreeItem extends NoteTargetTreeItem {
  readonly directory: boolean;

  constructor(
    state: WorkspaceNotesState,
    noteKey: string,
    uri: vscode.Uri,
    type: vscode.FileType,
  ) {
    const directory = isDirectory(type);
    super(
      state,
      noteKey,
      uri,
      entryLabel(uri),
      directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.directory = directory;
    this.iconPath = directory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
    const note = state.noteForKey(noteKey);
    this.contextValue =
      note === undefined ? "codebaseNotes.entry" : "codebaseNotes.entryWithNote";
    this.applyNote(note);
    if (!directory) {
      this.command = {
        command: "vscode.open",
        title: vscode.l10n.t("Open"),
        arguments: [uri],
      };
    }
  }
}

class PlainWorkspaceEntryTreeItem extends WorkspaceNodeTreeItem {
  readonly directory: boolean;

  constructor(
    state: WorkspaceNotesState,
    entryKey: string,
    uri: vscode.Uri,
    type: vscode.FileType,
  ) {
    const directory = isDirectory(type);
    super(
      state,
      entryKey,
      uri,
      entryLabel(uri),
      directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.directory = directory;
    this.iconPath = directory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
    this.contextValue =
      entryKey === ".codebase-notes.json"
        ? "codebaseNotes.config"
        : "codebaseNotes.unavailable";
    if (!directory) {
      this.command = {
        command: "vscode.open",
        title: vscode.l10n.t("Open"),
        arguments: [uri],
      };
    }
  }
}

export class MissingNotesGroupTreeItem extends vscode.TreeItem {
  constructor(
    readonly state: WorkspaceNotesState,
    count: number,
  ) {
    super(
      vscode.l10n.t("Missing Notes"),
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `${state.folder.uri.toString()}::missing-notes`;
    this.description = String(count);
    this.contextValue = "codebaseNotes.missingGroup";
    this.iconPath = new vscode.ThemeIcon("warning");
  }
}

export class MissingNoteTreeItem extends NoteTargetTreeItem {
  constructor(state: WorkspaceNotesState, noteKey: string) {
    const uri = state.uriForKey(noteKey);
    super(
      state,
      noteKey,
      uri,
      noteKey,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = "codebaseNotes.missing";
    this.iconPath = new vscode.ThemeIcon("warning");
    this.applyNote(state.noteForKey(noteKey));
  }
}

export type NotesTreeItem =
  | RootTreeItem
  | WorkspaceEntryTreeItem
  | PlainWorkspaceEntryTreeItem
  | MissingNotesGroupTreeItem
  | MissingNoteTreeItem;

export class NotesExplorerProvider
  implements vscode.TreeDataProvider<NotesTreeItem>, vscode.Disposable
{
  readonly #onDidChangeTreeDataEmitter =
    new vscode.EventEmitter<NotesTreeItem | undefined>();
  readonly onDidChangeTreeData = this.#onDidChangeTreeDataEmitter.event;
  readonly #disposables: vscode.Disposable[] = [];
  readonly #workspaceWatchers = new Map<string, vscode.Disposable[]>();

  constructor(readonly manager: NotesWorkspaceManager) {
    this.#syncWorkspaceWatchers();
    this.#disposables.push(
      manager.onDidChange(() => {
        this.#syncWorkspaceWatchers();
        this.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("files.exclude")) {
          this.refresh();
        }
      }),
    );
  }

  refresh(element?: NotesTreeItem): void {
    this.#onDidChangeTreeDataEmitter.fire(element);
  }

  getTreeItem(element: NotesTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NotesTreeItem): Promise<NotesTreeItem[]> {
    if (element === undefined) {
      return this.manager
        .allStates()
        .map((state) => new RootTreeItem(state));
    }
    if (element instanceof RootTreeItem) {
      const entries = await this.#readDirectory(
        element.state,
        element.state.folder.uri,
        ".",
      );
      const missing = await this.#missingKeys(element.state);
      if (missing.length > 0) {
        entries.push(new MissingNotesGroupTreeItem(element.state, missing.length));
      }
      return entries;
    }
    if (
      (element instanceof WorkspaceEntryTreeItem ||
        element instanceof PlainWorkspaceEntryTreeItem) &&
      element.directory
    ) {
      return this.#readDirectory(
        element.state,
        element.targetUri,
        element.entryKey,
      );
    }
    if (element instanceof MissingNotesGroupTreeItem) {
      return (await this.#missingKeys(element.state)).map(
        (key) => new MissingNoteTreeItem(element.state, key),
      );
    }
    return [];
  }

  async getParent(element: NotesTreeItem): Promise<NotesTreeItem | undefined> {
    if (element instanceof RootTreeItem) {
      return undefined;
    }
    if (element instanceof MissingNotesGroupTreeItem) {
      return new RootTreeItem(element.state);
    }
    if (element instanceof MissingNoteTreeItem) {
      const count = (await this.#missingKeys(element.state)).length;
      return new MissingNotesGroupTreeItem(element.state, count);
    }
    if (
      element instanceof WorkspaceEntryTreeItem ||
      element instanceof PlainWorkspaceEntryTreeItem
    ) {
      const separator = element.entryKey.lastIndexOf("/");
      if (separator < 0) {
        return new RootTreeItem(element.state);
      }
      const parentKey = element.entryKey.slice(0, separator);
      return this.#createEntryItem(
        element.state,
        element.state.uriForKey(parentKey),
        parentKey,
        vscode.FileType.Directory,
      );
    }
    return undefined;
  }

  async itemForUri(uri: vscode.Uri): Promise<NotesTreeItem | undefined> {
    if (uri.scheme !== "file") {
      return undefined;
    }
    const state = this.manager.stateForUri(uri);
    if (state === undefined) {
      return undefined;
    }
    const relative = path.relative(state.folder.uri.fsPath, uri.fsPath);
    if (relative.length === 0) {
      return new RootTreeItem(state);
    }
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return undefined;
    }
    const entryKey = relative.split(path.sep).join("/");
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return this.#createEntryItem(state, uri, entryKey, stat.type);
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    for (const disposables of this.#workspaceWatchers.values()) {
      disposables.forEach((disposable) => disposable.dispose());
    }
    this.#workspaceWatchers.clear();
    this.#disposables.forEach((disposable) => disposable.dispose());
    this.#onDidChangeTreeDataEmitter.dispose();
  }

  async #readDirectory(
    state: WorkspaceNotesState,
    uri: vscode.Uri,
    parentKey: string,
  ): Promise<NotesTreeItem[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(uri);
    } catch {
      return [];
    }
    const excludes = vscode.workspace
      .getConfiguration("files", state.folder.uri)
      .get<FilesExcludePatterns>("exclude", {});

    return entries
      .map(([name, type]) => {
        const entryKey = parentKey === "." ? name : `${parentKey}/${name}`;
        return { name, type, entryKey, isDirectory: isDirectory(type) };
      })
      .filter(({ entryKey }) => !shouldExcludePath(entryKey, excludes))
      .sort(compareTreeEntries)
      .map(({ name, type, entryKey }) =>
        this.#createEntryItem(
          state,
          vscode.Uri.joinPath(uri, name),
          entryKey,
          type,
        ),
      );
  }

  #createEntryItem(
    state: WorkspaceNotesState,
    uri: vscode.Uri,
    entryKey: string,
    type: vscode.FileType,
  ): WorkspaceEntryTreeItem | PlainWorkspaceEntryTreeItem {
    return isValidNoteKey(entryKey)
      ? new WorkspaceEntryTreeItem(state, entryKey, uri, type)
      : new PlainWorkspaceEntryTreeItem(state, entryKey, uri, type);
  }

  async #missingKeys(state: WorkspaceNotesState): Promise<string[]> {
    const candidates = searchNotes(state.snapshot?.config.notes ?? {}, "").map(
      ({ key }) => key,
    );
    const checks = await Promise.all(
      candidates.map(async (key) => {
        try {
          await vscode.workspace.fs.stat(state.uriForKey(key));
          return undefined;
        } catch {
          return key;
        }
      }),
    );
    return checks.filter((key): key is string => key !== undefined);
  }

  #syncWorkspaceWatchers(): void {
    const stateIds = new Set(
      this.manager.allStates().map((state) => state.folder.uri.toString()),
    );
    for (const [id, disposables] of this.#workspaceWatchers) {
      if (!stateIds.has(id)) {
        disposables.forEach((disposable) => disposable.dispose());
        this.#workspaceWatchers.delete(id);
      }
    }
    for (const state of this.manager.allStates()) {
      const id = state.folder.uri.toString();
      if (this.#workspaceWatchers.has(id)) {
        continue;
      }
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(state.folder, "**/*"),
      );
      const refresh = (): void => this.refresh();
      this.#workspaceWatchers.set(id, [
        watcher,
        watcher.onDidCreate(refresh),
        watcher.onDidDelete(refresh),
      ]);
    }
  }
}
