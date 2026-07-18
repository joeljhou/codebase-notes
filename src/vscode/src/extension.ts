import { readFileSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { ConfigParser } from "./core/parser.js";
import type { Localize } from "./core/localize.js";
import { ConfigRepository } from "./core/repository.js";
import { NotesWorkspaceManager } from "./platform/workspace-manager.js";
import { registerCommands } from "./ui/commands.js";
import { NoteDecorationProvider } from "./ui/decoration-provider.js";
import {
  NotesExplorerProvider,
} from "./ui/tree-provider.js";
import {
  NOTES_WEBVIEW_VIEW_ID,
  NotesWebviewProvider,
} from "./ui/webview-provider.js";

export interface CodebaseNotesApi {
  manager: NotesWorkspaceManager;
  treeProvider: NotesExplorerProvider;
  webviewProvider: NotesWebviewProvider;
  decorationProvider: NoteDecorationProvider;
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<CodebaseNotesApi> {
  const schema = JSON.parse(
    readFileSync(
      path.join(context.extensionPath, "resources", "codebase-notes.schema.json"),
      "utf8",
    ),
  ) as object;
  const localize: Localize = (message, ...args) =>
    vscode.l10n.t(message, ...args);
  const repository = new ConfigRepository(new ConfigParser(schema, localize));
  const manager = new NotesWorkspaceManager(repository, localize);
  const treeProvider = new NotesExplorerProvider(manager);
  const webviewProvider = new NotesWebviewProvider(
    context.extensionUri,
    manager,
    treeProvider,
  );
  const webviewRegistration = vscode.window.registerWebviewViewProvider(
    NOTES_WEBVIEW_VIEW_ID,
    webviewProvider,
  );
  const decorationProvider = new NoteDecorationProvider(manager);
  const revealUri = async (
    uri: vscode.Uri,
    select: boolean,
  ): Promise<void> => {
    await webviewProvider.revealUri(uri, select);
  };

  context.subscriptions.push(
    manager,
    treeProvider,
    webviewProvider,
    webviewRegistration,
    decorationProvider,
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) {
        void revealUri(editor.document.uri, false);
      }
    }),
    vscode.window.registerFileDecorationProvider(decorationProvider),
    ...registerCommands(
      manager,
      (uri) => revealUri(uri, true),
      () => webviewProvider.commandTarget(),
    ),
  );

  try {
    await manager.initialize();
    const editor = vscode.window.activeTextEditor;
    if (editor !== undefined) {
      await revealUri(editor.document.uri, false);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Codebase Notes failed to initialize: {0}",
        (error as Error).message,
      ),
    );
  }

  return { manager, treeProvider, webviewProvider, decorationProvider };
}

export function deactivate(): void {
  // VS Code 会 dispose context.subscriptions，这里无需维护第二套生命周期。
}
