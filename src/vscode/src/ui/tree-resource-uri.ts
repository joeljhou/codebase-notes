import * as vscode from "vscode";

const NOTES_VIEW_FRAGMENT = "codebase-notes-view";

// 使用同一文件路径的专用 URI 身份，让颜色装饰只出现在代码备注树中。
export function notesViewResourceUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({ fragment: NOTES_VIEW_FRAGMENT });
}

export function notesViewTargetUri(uri: vscode.Uri): vscode.Uri | undefined {
  return uri.fragment === NOTES_VIEW_FRAGMENT
    ? uri.with({ fragment: "" })
    : undefined;
}
