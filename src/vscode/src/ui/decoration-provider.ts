import * as vscode from "vscode";
import { NotesWorkspaceManager } from "../platform/workspace-manager.js";
import { noteStyleThemeColor, resolvedNoteStyle } from "./note-style.js";

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
    const state = this.manager.stateForUri(uri);
    if (state?.snapshot === undefined) {
      return undefined;
    }
    try {
      const key = await state.keyForUri(uri);
      const note = state.noteForKey(key);
      if (note === undefined) {
        return undefined;
      }
      return {
        badge: "N",
        tooltip: note.text,
        color: new vscode.ThemeColor(
          noteStyleThemeColor(
            this.manager.previewedNoteStyle(state, key) ?? resolvedNoteStyle(note),
          ),
        ),
      };
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    this.#changeSubscription.dispose();
    this.#onDidChangeFileDecorationsEmitter.dispose();
  }
}
