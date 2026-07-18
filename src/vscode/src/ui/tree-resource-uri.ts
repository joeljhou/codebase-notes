import * as vscode from "vscode";

export const NOTES_VIEW_SCHEME = "codebase-notes";

// 使用同一文件路径的专用 URI 身份，让颜色装饰只出现在代码备注树中。
export function notesViewResourceUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({ scheme: NOTES_VIEW_SCHEME, fragment: "" });
}

export function notesViewTargetUri(uri: vscode.Uri): vscode.Uri | undefined {
  return uri.scheme === NOTES_VIEW_SCHEME
    ? uri.with({ scheme: "file" })
    : undefined;
}
