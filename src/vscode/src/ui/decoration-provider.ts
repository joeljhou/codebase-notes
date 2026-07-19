import * as vscode from "vscode";
import { NotesWorkspaceManager } from "../platform/workspace-manager.js";
import { noteStyleThemeColor, resolvedNoteStyle } from "./note-style.js";
import {
  notesViewResourceUri,
  notesViewTargetUri,
} from "./tree-resource-uri.js";

export class NoteDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  readonly #onDidChangeFileDecorationsEmitter = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations =
    this.#onDidChangeFileDecorationsEmitter.event;
  readonly #changeSubscriptions: vscode.Disposable[];

  constructor(readonly manager: NotesWorkspaceManager) {
    this.#changeSubscriptions = [
      manager.onDidChange(() => {
        // 配置变化可能同时影响目录后代，需要让 VS Code 重新读取全部装饰。
        this.#onDidChangeFileDecorationsEmitter.fire(undefined);
      }),
      manager.onDidChangeNoteStylePreview(({ state, key }) => {
        // 样式预览只影响当前节点，避免重建整棵代码备注树。
        this.#onDidChangeFileDecorationsEmitter.fire(
          notesViewResourceUri(state.uriForKey(key)),
        );
      }),
    ];
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
        undefined,
        note.text,
        color === undefined ? undefined : new vscode.ThemeColor(color),
      );
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    this.#changeSubscriptions.forEach((subscription) => subscription.dispose());
    this.#onDidChangeFileDecorationsEmitter.dispose();
  }
}
