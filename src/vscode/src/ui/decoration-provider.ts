import * as vscode from "vscode";
import { NotesWorkspaceManager } from "../platform/workspace-manager.js";
import { noteStyleThemeColor, resolvedNoteStyle } from "./note-style.js";
import { notesViewTargetUri } from "./tree-resource-uri.js";

export class NoteDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  readonly #onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations =
    this.#onDidChangeFileDecorationsEmitter.event;
  readonly #changeSubscription: vscode.Disposable;

  constructor(readonly manager: NotesWorkspaceManager) {
    this.#changeSubscription = manager.onDidChange(() => {
      // 配置变化可能同时影响目录后代；先全量失效，后续有性能数据再做局部刷新。
      this.#onDidChangeFileDecorationsEmitter.fire(undefined);
    });
  }

  async provideFileDecoration(
    uri: vscode.Uri,
  ): Promise<vscode.FileDecoration | undefined> {
    const targetUri = notesViewTargetUri(uri);
    if (targetUri === undefined) {
      return undefined;
    }
    const state = this.manager.stateForUri(targetUri);
    if (state?.snapshot === undefined) {
      return undefined;
    }
    try {
      const key = await state.keyForUri(targetUri);
      const note = state.noteForKey(key);
      if (note === undefined) {
        return undefined;
      }
      const style =
        this.manager.previewedNoteStyle(state, key) ?? resolvedNoteStyle(note);
      const color = noteStyleThemeColor(style);
      return new vscode.FileDecoration(
        "N",
        note.text,
        color === undefined ? undefined : new vscode.ThemeColor(color),
      );
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    this.#changeSubscription.dispose();
    this.#onDidChangeFileDecorationsEmitter.dispose();
  }
}
