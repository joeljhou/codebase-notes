import path from "node:path";
import * as vscode from "vscode";
import { configPathLocations } from "../core/config-paths.js";
import type { NotesWorkspaceManager } from "../platform/workspace-manager.js";

export class ConfigPathLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly manager: NotesWorkspaceManager) {}

  async provideDocumentLinks(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): Promise<vscode.DocumentLink[]> {
    if (document.uri.scheme !== "file") return [];
    const state = this.manager.stateForUri(document.uri);
    if (state === undefined || path.resolve(document.uri.fsPath) !== path.resolve(state.configPath)) return [];
    const version = document.version;
    const links = await Promise.all(configPathLocations(document.getText()).map(async (location) => {
      if (token.isCancellationRequested) return undefined;
      const range = new vscode.Range(
        document.positionAt(location.offset),
        document.positionAt(location.offset + location.length),
      );
      const uri = state.uriForKey(location.key);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        return undefined;
      }
      const target = vscode.Uri.parse(`command:codebaseNotes.revealInExplorer?${encodeURIComponent(JSON.stringify([uri]))}`);
      if (document.version !== version || token.isCancellationRequested) return undefined;
      const link = new vscode.DocumentLink(range, target);
      link.tooltip = vscode.l10n.t("Reveal in Explorer: {0}", uri.fsPath);
      return link;
    }));
    return token.isCancellationRequested ? [] : links.filter((link) => link !== undefined);
  }
}
