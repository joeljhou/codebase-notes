import { access } from "node:fs/promises";
import * as vscode from "vscode";
import { planMove } from "../core/move.js";
import { searchNotes } from "../core/search.js";
import type { ConfigSnapshot, OperationResult } from "../core/repository.js";
import {
  NotesWorkspaceManager,
  WorkspaceNotesState,
} from "../platform/workspace-manager.js";
import { noteIntentFromText, validateNoteText } from "./note-input.js";
import {
  noteIntentFromStyle,
  noteStyleThemeColor,
  resolvedNoteStyle,
  SELECTABLE_NOTE_STYLES,
  type SelectableNoteStyle,
} from "./note-style.js";
import {
  MissingNoteTreeItem,
  NoteTargetTreeItem,
  WorkspaceNodeTreeItem,
} from "./tree-provider.js";
import { notesViewTargetUri } from "./tree-resource-uri.js";
import type { Localize } from "../core/localize.js";

const localize: Localize = (message, ...args) =>
  vscode.l10n.t(message, ...args);

interface ResolvedTarget {
  state: WorkspaceNotesState;
  key: string;
  uri: vscode.Uri;
}

interface SearchPick extends vscode.QuickPickItem {
  state: WorkspaceNotesState;
  key: string;
}

interface StylePick extends vscode.QuickPickItem {
  style: SelectableNoteStyle;
}

type RevealNote = (uri: vscode.Uri) => vscode.ProviderResult<void>;
type CommandTarget = () => unknown;

interface CommandUi {
  revealNote?: RevealNote;
  revealInNotes?: RevealNote;
  revealInExplorer?: RevealNote;
  commandTarget?: CommandTarget;
}

function looksLikeUri(value: unknown): value is vscode.Uri {
  return (
    typeof value === "object" &&
    value !== null &&
    "scheme" in value &&
    "fsPath" in value &&
    typeof (value as { fsPath?: unknown }).fsPath === "string"
  );
}

async function resolveTarget(
  manager: NotesWorkspaceManager,
  value: unknown,
  commandTarget?: CommandTarget,
): Promise<ResolvedTarget | undefined> {
  const candidate =
    value instanceof NoteTargetTreeItem || looksLikeUri(value)
      ? value
      : commandTarget?.();
  if (candidate instanceof NoteTargetTreeItem) {
    return {
      state: candidate.state,
      key: candidate.noteKey,
      uri: candidate.targetUri,
    };
  }
  const uri = looksLikeUri(candidate)
    ? candidate
    : vscode.window.activeTextEditor?.document.uri;
  if (uri === undefined || uri.scheme !== "file") {
    return undefined;
  }
  const state = manager.stateForUri(uri);
  if (state === undefined) {
    return undefined;
  }
  try {
    return { state, key: await state.keyForUri(uri), uri };
  } catch (error) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Codebase Notes could not locate the path: {0}",
        (error as Error).message,
      ),
    );
    return undefined;
  }
}

function resolveResourceUri(
  value: unknown,
  commandTarget?: CommandTarget,
): vscode.Uri | undefined {
  const candidate =
    value instanceof WorkspaceNodeTreeItem || looksLikeUri(value)
      ? value
      : commandTarget?.();
  if (candidate instanceof WorkspaceNodeTreeItem) {
    return candidate.targetUri;
  }
  if (looksLikeUri(candidate)) {
    return notesViewTargetUri(candidate) ?? candidate;
  }
  return vscode.window.activeTextEditor?.document.uri;
}

async function ensureSnapshot(
  manager: NotesWorkspaceManager,
  state: WorkspaceNotesState,
): Promise<ConfigSnapshot | undefined> {
  if (state.snapshot !== undefined) {
    return state.snapshot;
  }
  if (state.kind === "diagnostic") {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        "The Codebase Notes configuration is not writable: {0}",
        state.diagnostic?.message ?? vscode.l10n.t("Unknown error"),
      ),
    );
    return undefined;
  }
  const create = vscode.l10n.t("Create");
  const answer = await vscode.window.showInformationMessage(
    vscode.l10n.t(
      "This workspace does not have a .codebase-notes.json file yet. Create it?",
    ),
    { modal: true },
    create,
  );
  if (answer !== create) {
    return undefined;
  }
  const result = await state.repository.create(state.configPath);
  state.accept(result);
  manager.notifyStateChanged();
  if (result.kind === "committed" || result.kind === "no-change") {
    return result.snapshot;
  }
  await showOperationFailure(result);
  return undefined;
}

async function showOperationFailure(result: OperationResult): Promise<void> {
  if (result.kind === "conflict") {
    await vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Codebase Notes write conflict: {0}. Refresh and try again.",
        result.paths.join(", "),
      ),
    );
  } else if (result.kind === "failed") {
    await vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Codebase Notes write failed [{0}]: {1}",
        result.code,
        result.message,
      ),
    );
  }
}

async function applyResult(
  manager: NotesWorkspaceManager,
  state: WorkspaceNotesState,
  result: OperationResult,
): Promise<boolean> {
  state.accept(result);
  manager.notifyStateChanged();
  if (result.kind === "committed" || result.kind === "no-change") {
    return true;
  }
  await showOperationFailure(result);
  return false;
}

function rejectDirtyConfig(state: WorkspaceNotesState): boolean {
  if (!state.isConfigDocumentDirty()) {
    return false;
  }
  void vscode.window.showErrorMessage(
    vscode.l10n.t(
      "Save or discard the unsaved changes in .codebase-notes.json before editing notes.",
    ),
  );
  return true;
}

async function editNote(
  manager: NotesWorkspaceManager,
  value: unknown,
  commandTarget?: CommandTarget,
): Promise<void> {
  const target = await resolveTarget(manager, value, commandTarget);
  if (target === undefined || rejectDirtyConfig(target.state)) {
    return;
  }
  const baseSnapshot = target.state.snapshot;
  if (baseSnapshot === undefined && target.state.kind === "diagnostic") {
    await ensureSnapshot(manager, target.state);
    return;
  }
  const existing = baseSnapshot?.config.notes[target.key];
  const text = await vscode.window.showInputBox({
    title: vscode.l10n.t("Edit Text Note"),
    value: existing?.text ?? "",
    validateInput: (value) => validateNoteText(value, localize),
  });
  if (text === undefined) {
    return;
  }

  const intent = noteIntentFromText(existing, text);
  if (intent === null && (baseSnapshot === undefined || existing === undefined)) {
    return;
  }
  const snapshot = baseSnapshot ?? (await ensureSnapshot(manager, target.state));
  if (snapshot === undefined) {
    return;
  }

  // UI 只编辑 text，展开旧对象可保留 style 和未来小版本字段。
  const result = await target.state.repository.setNote(
    snapshot,
    target.key,
    intent,
  );
  await applyResult(manager, target.state, result);
}

async function setNoteStyle(
  manager: NotesWorkspaceManager,
  value: unknown,
  commandTarget?: CommandTarget,
): Promise<void> {
  const target = await resolveTarget(manager, value, commandTarget);
  if (target === undefined || rejectDirtyConfig(target.state)) {
    return;
  }
  const snapshot = target.state.snapshot;
  if (snapshot === undefined) {
    return;
  }
  const existing = snapshot.config.notes[target.key];
  if (existing === undefined) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t("Add a text note before setting its style."),
    );
    return;
  }

  const current = resolvedNoteStyle(existing);
  const labels: Record<SelectableNoteStyle, string> = {
    default: vscode.l10n.t("Default"),
    info: vscode.l10n.t("Info"),
    success: vscode.l10n.t("Success"),
    warning: vscode.l10n.t("Warning"),
    danger: vscode.l10n.t("Danger"),
  };
  const items: StylePick[] = SELECTABLE_NOTE_STYLES.map((style) => {
    const color = noteStyleThemeColor(style) ?? "descriptionForeground";
    return {
      label: labels[style],
      iconPath: new vscode.ThemeIcon(
        "circle-filled",
        new vscode.ThemeColor(color),
      ),
      style,
    };
  });
  const initialItem = items.find((item) => item.style === current) ?? items[0];
  if (initialItem === undefined) {
    return;
  }
  const quickPick = vscode.window.createQuickPick<StylePick>();
  quickPick.title = vscode.l10n.t("Set Note Style");
  quickPick.placeholder = vscode.l10n.t(
    "Up/Down preview · Enter save · Esc cancel",
  );
  quickPick.items = items;
  quickPick.activeItems = [initialItem];

  await new Promise<void>((resolve) => {
    let saving = false;
    let finished = false;
    const subscriptions: vscode.Disposable[] = [];
    const finish = (): void => {
      if (finished) return;
      finished = true;
      subscriptions.forEach((subscription) => subscription.dispose());
      quickPick.dispose();
      resolve();
    };

    subscriptions.push(
      quickPick.onDidChangeActive(([item]) => {
        if (!saving && item !== undefined) {
          manager.setNoteStylePreview(target.state, target.key, item.style);
        }
      }),
      quickPick.onDidHide(() => {
        if (!saving) {
          manager.setNoteStylePreview(target.state, target.key, undefined);
          finish();
        }
      }),
      quickPick.onDidAccept(() => {
        const selected = quickPick.activeItems[0];
        if (saving || selected === undefined) return;
        saving = true;
        void (async () => {
          try {
            const result = await target.state.repository.setNote(
              snapshot,
              target.key,
              noteIntentFromStyle(existing, selected.style),
            );
            manager.setNoteStylePreview(target.state, target.key, undefined);
            await applyResult(manager, target.state, result);
          } finally {
            quickPick.hide();
            finish();
          }
        })();
      }),
    );

    const initial = quickPick.activeItems[0];
    if (initial !== undefined) {
      manager.setNoteStylePreview(target.state, target.key, initial.style);
    }
    quickPick.show();
  });
}

async function removeNote(
  manager: NotesWorkspaceManager,
  value: unknown,
  commandTarget?: CommandTarget,
): Promise<void> {
  const target = await resolveTarget(manager, value, commandTarget);
  if (
    target === undefined ||
    target.state.snapshot === undefined ||
    rejectDirtyConfig(target.state)
  ) {
    return;
  }
  if (target.state.snapshot.config.notes[target.key] === undefined) {
    return;
  }
  const clear = vscode.l10n.t("Clear");
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t("Clear the note for {0}?", target.key),
    { modal: true },
    clear,
  );
  if (answer !== clear) {
    return;
  }
  const result = await target.state.repository.setNote(
    target.state.snapshot,
    target.key,
    null,
  );
  await applyResult(manager, target.state, result);
}

async function search(
  manager: NotesWorkspaceManager,
  revealNote?: RevealNote,
): Promise<void> {
  const query = await vscode.window.showInputBox({
    title: vscode.l10n.t("Search Codebase Notes"),
    prompt: vscode.l10n.t("Search paths and note text"),
  });
  if (query === undefined) {
    return;
  }
  const picks: SearchPick[] = [];
  for (const state of manager.allStates()) {
    if (state.snapshot === undefined) {
      continue;
    }
    for (const result of searchNotes(state.snapshot.config.notes, query)) {
      picks.push({
        label: result.key,
        description: result.note.text.replace(/\s+/gu, " ").trim(),
        detail: state.folder.name,
        state,
        key: result.key,
      });
    }
  }
  const selected = await vscode.window.showQuickPick(picks, {
    placeHolder:
      picks.length === 0
        ? vscode.l10n.t("No matching notes")
        : vscode.l10n.t("Select a note to reveal"),
    matchOnDescription: false,
    matchOnDetail: false,
  });
  if (selected !== undefined) {
    const uri = selected.state.uriForKey(selected.key);
    if (revealNote === undefined) {
      await vscode.commands.executeCommand("revealInExplorer", uri);
    } else {
      await revealNote(uri);
    }
  }
}

async function missingKeys(
  manager: NotesWorkspaceManager,
): Promise<Array<{ state: WorkspaceNotesState; key: string }>> {
  const result: Array<{ state: WorkspaceNotesState; key: string }> = [];
  for (const state of manager.allStates()) {
    for (const key of Object.keys(state.snapshot?.config.notes ?? {})) {
      try {
        await access(state.uriForKey(key).fsPath);
      } catch {
        result.push({ state, key });
      }
    }
  }
  return result;
}

async function chooseMissingPrefix(
  manager: NotesWorkspaceManager,
  value: unknown,
): Promise<{ state: WorkspaceNotesState; key: string } | undefined> {
  if (value instanceof MissingNoteTreeItem) {
    return { state: value.state, key: value.noteKey };
  }
  const missing = await missingKeys(manager);
  return vscode.window.showQuickPick(
    missing.map(({ state, key }) => ({
      label: key,
      description: state.folder.name,
      state,
      key,
    })),
    {
      placeHolder: vscode.l10n.t(
        "Select a missing note or old directory prefix",
      ),
    },
  );
}

async function relink(
  manager: NotesWorkspaceManager,
  value: unknown,
): Promise<void> {
  const source = await chooseMissingPrefix(manager, value);
  if (
    source === undefined ||
    source.state.snapshot === undefined ||
    rejectDirtyConfig(source.state)
  ) {
    return;
  }
  const selected = await vscode.window.showOpenDialog({
    defaultUri: source.state.folder.uri,
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t("Select New Path"),
  });
  const targetUri = selected?.[0];
  if (
    targetUri === undefined ||
    manager.stateForUri(targetUri) !== source.state
  ) {
    if (targetUri !== undefined) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          "Version 1 can only relink paths within the same workspace root.",
        ),
      );
    }
    return;
  }

  const newPrefix = await source.state.keyForUri(targetUri);
  const plan = planMove(
    source.state.snapshot.config.notes,
    source.key,
    newPrefix,
  );
  if (plan.kind === "conflict") {
    await showOperationFailure({
      kind: "conflict",
      code: "CBN003_WRITE_CONFLICT",
      paths: plan.paths,
    });
    return;
  }
  const count = Object.keys(plan.mapping).length;
  if (count === 0) {
    return;
  }
  const continueLabel = vscode.l10n.t("Continue");
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      "Move {0} note(s) from {1} to {2}?",
      count,
      source.key,
      newPrefix,
    ),
    { modal: true },
    continueLabel,
  );
  if (answer !== continueLabel) {
    return;
  }
  const result = await source.state.repository.move(
    source.state.snapshot,
    source.key,
    newPrefix,
  );
  await applyResult(manager, source.state, result);
}

export function registerCommands(
  manager: NotesWorkspaceManager,
  ui: CommandUi = {},
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("codebaseNotes.editNote", (value) =>
      editNote(manager, value, ui.commandTarget),
    ),
    vscode.commands.registerCommand("codebaseNotes.removeNote", (value) =>
      removeNote(manager, value, ui.commandTarget),
    ),
    vscode.commands.registerCommand("codebaseNotes.setNoteStyle", (value) =>
      setNoteStyle(manager, value, ui.commandTarget),
    ),
    vscode.commands.registerCommand("codebaseNotes.searchNotes", () =>
      search(manager, ui.revealNote),
    ),
    vscode.commands.registerCommand("codebaseNotes.relinkNote", (value) =>
      relink(manager, value),
    ),
    vscode.commands.registerCommand("codebaseNotes.relinkPrefix", (value) =>
      relink(manager, value),
    ),
    vscode.commands.registerCommand("codebaseNotes.refresh", () =>
      manager.refreshAll(),
    ),
    vscode.commands.registerCommand("codebaseNotes.revealInNotes", (value) => {
      // 从系统资源管理器进入时优先使用显式资源；命令面板则回退到活动编辑器。
      const uri = resolveResourceUri(value);
      return uri === undefined ? undefined : ui.revealInNotes?.(uri);
    }),
    vscode.commands.registerCommand(
      "codebaseNotes.revealInExplorer",
      (value) => {
        const uri = resolveResourceUri(value, ui.commandTarget);
        return uri === undefined ? undefined : ui.revealInExplorer?.(uri);
      },
    ),
  ];
}
