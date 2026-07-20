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
  type NotesTreeItem,
} from "./ui/tree-provider.js";

export interface CodebaseNotesApi {
  manager: NotesWorkspaceManager;
  treeProvider: NotesExplorerProvider;
  treeView: vscode.TreeView<NotesTreeItem>;
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
  const treeView = vscode.window.createTreeView(
    "codebaseNotes.annotatedFiles",
    {
      treeDataProvider: treeProvider,
      showCollapseAll: true,
    },
  );
  const decorationProvider = new NoteDecorationProvider(manager);
  const revealUri = async (
    uri: vscode.Uri,
    select: boolean,
    focus = false,
  ): Promise<void> => {
    if (focus) {
      await vscode.commands.executeCommand("codebaseNotes.annotatedFiles.focus");
    } else if (!treeView.visible) {
      return;
    }
    const item = await treeProvider.itemForUri(uri);
    if (item !== undefined) {
      await treeView.reveal(item, {
        select,
        focus: false,
        expand: false,
      });
    }
  };

  context.subscriptions.push(
    manager,
    treeProvider,
    treeView,
    decorationProvider,
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor !== undefined) {
        void revealUri(editor.document.uri, true);
      }
    }),
    treeView.onDidChangeVisibility(({ visible }) => {
      const editor = vscode.window.activeTextEditor;
      if (visible && editor !== undefined) {
        void revealUri(editor.document.uri, true);
      }
    }),
    vscode.window.registerFileDecorationProvider(decorationProvider),
    ...registerCommands(
      manager,
      {
        extensionUri: context.extensionUri,
        revealNote: (uri) => revealUri(uri, true),
        revealInNotes: (uri) => revealUri(uri, true, true),
        revealInExplorer: async (uri) => {
          await vscode.commands.executeCommand("workbench.view.explorer");
          await vscode.commands.executeCommand("revealInExplorer", uri);
        },
        commandTarget: () => treeView.selection[0],
      },
    ),
  );

  try {
    await manager.initialize();
    const editor = vscode.window.activeTextEditor;
    if (editor !== undefined) {
      await revealUri(editor.document.uri, true);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Codebase Notes failed to initialize: {0}",
        (error as Error).message,
      ),
    );
  }

  return { manager, treeProvider, treeView, decorationProvider };
}

export function deactivate(): void {
  // VS Code 会 dispose context.subscriptions，这里无需维护第二套生命周期。
}
