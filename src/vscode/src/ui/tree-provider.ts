import { access } from "node:fs/promises";
import * as vscode from "vscode";
import { searchNotes } from "../core/search.js";
import {
  NotesWorkspaceManager,
  WorkspaceNotesState,
} from "../platform/workspace-manager.js";

export class RootTreeItem extends vscode.TreeItem {
  constructor(readonly state: WorkspaceNotesState) {
    super(state.folder.name, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "codebaseNotes.root";
    this.iconPath = new vscode.ThemeIcon("root-folder");
    if (state.kind === "diagnostic" && state.diagnostic !== undefined) {
      this.description = state.diagnostic.code;
      this.tooltip = state.diagnostic.message;
    } else if (state.kind === "missing") {
      this.description = vscode.l10n.t("No configuration");
    }
  }
}

export class NoteTreeItem extends vscode.TreeItem {
  constructor(
    readonly state: WorkspaceNotesState,
    readonly noteKey: string,
    readonly missing: boolean,
  ) {
    const note = state.noteForKey(noteKey);
    super(noteKey, vscode.TreeItemCollapsibleState.None);
    this.resourceUri = state.uriForKey(noteKey);
    if (note !== undefined) {
      this.description = note.text.replace(/\s+/gu, " ").trim();
      this.tooltip = note.text;
    }
    this.contextValue = missing
      ? "codebaseNotes.missing"
      : "codebaseNotes.note";
    this.iconPath = new vscode.ThemeIcon(missing ? "warning" : "note");
  }
}

export type NotesTreeItem = RootTreeItem | NoteTreeItem;

export class AnnotatedFilesProvider
  implements vscode.TreeDataProvider<NotesTreeItem>, vscode.Disposable
{
  readonly #onDidChangeTreeDataEmitter =
    new vscode.EventEmitter<NotesTreeItem | undefined>();
  readonly onDidChangeTreeData = this.#onDidChangeTreeDataEmitter.event;
  readonly #changeSubscription: vscode.Disposable;

  constructor(readonly manager: NotesWorkspaceManager) {
    this.#changeSubscription = manager.onDidChange(() => {
      this.#onDidChangeTreeDataEmitter.fire(undefined);
    });
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
    if (!(element instanceof RootTreeItem) || element.state.snapshot === undefined) {
      return [];
    }

    return Promise.all(
      searchNotes(element.state.snapshot.config.notes, "").map(
        async ({ key }) =>
          new NoteTreeItem(
            element.state,
            key,
            !(await this.#exists(element.state.uriForKey(key))),
          ),
      ),
    );
  }

  dispose(): void {
    this.#changeSubscription.dispose();
    this.#onDidChangeTreeDataEmitter.dispose();
  }

  async #exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await access(uri.fsPath);
      return true;
    } catch {
      return false;
    }
  }
}
