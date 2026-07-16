import { readFileSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { ConfigParser } from "./core/parser.js";
import type { Localize } from "./core/localize.js";
import { ConfigRepository } from "./core/repository.js";
import { NotesWorkspaceManager } from "./platform/workspace-manager.js";
import { registerCommands } from "./ui/commands.js";
import { NoteDecorationProvider } from "./ui/decoration-provider.js";
import { AnnotatedFilesProvider } from "./ui/tree-provider.js";

export interface CodebaseNotesApi {
  manager: NotesWorkspaceManager;
  treeProvider: AnnotatedFilesProvider;
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
  const treeProvider = new AnnotatedFilesProvider(manager);
  const decorationProvider = new NoteDecorationProvider(manager);

  context.subscriptions.push(
    manager,
    treeProvider,
    decorationProvider,
    vscode.window.registerTreeDataProvider(
      "codebaseNotes.annotatedFiles",
      treeProvider,
    ),
    vscode.window.registerFileDecorationProvider(decorationProvider),
    ...registerCommands(manager),
  );

  try {
    await manager.initialize();
  } catch (error) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Codebase Notes failed to initialize: {0}",
        (error as Error).message,
      ),
    );
  }

  return { manager, treeProvider, decorationProvider };
}

export function deactivate(): void {
  // VS Code 会 dispose context.subscriptions，这里无需维护第二套生命周期。
}
