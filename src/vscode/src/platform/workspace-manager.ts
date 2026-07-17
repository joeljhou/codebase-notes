import path from "node:path";
import * as vscode from "vscode";
import {
  noteKeyForTarget,
  isValidNoteKey,
  PathPolicyError,
} from "../core/path-policy.js";
import {
  ConfigRepository,
  type ConfigSnapshot,
  type OperationResult,
} from "../core/repository.js";
import type { DiagnosticCode, Note, NoteStyle } from "../core/types.js";
import { defaultLocalize, type Localize } from "../core/localize.js";

type StateKind = "loading" | "missing" | "loaded" | "diagnostic";

export class WorkspaceNotesState {
  kind: StateKind = "loading";
  snapshot: ConfigSnapshot | undefined;
  diagnostic:
    | { code: DiagnosticCode; message: string }
    | undefined;
  readonly configPath: string;
  readonly caseSensitive: boolean;

  constructor(
    readonly folder: vscode.WorkspaceFolder,
    readonly repository: ConfigRepository,
    readonly localize: Localize = defaultLocalize,
  ) {
    this.configPath = path.join(folder.uri.fsPath, ".codebase-notes.json");
    // v1 先覆盖主流本地文件系统；核心测试不依赖该启发式，而是显式传入。
    this.caseSensitive =
      process.platform !== "darwin" && process.platform !== "win32";
  }

  async refresh(): Promise<void> {
    const loaded = await this.repository.load(this.configPath);
    this.snapshot = undefined;
    this.diagnostic = undefined;
    if (loaded.kind === "loaded") {
      this.kind = "loaded";
      this.snapshot = loaded.snapshot;
    } else if (loaded.kind === "missing") {
      this.kind = "missing";
    } else {
      this.kind = "diagnostic";
      this.diagnostic =
        loaded.result.mode === "invalid"
          ? {
              code: loaded.result.code,
              message: loaded.result.message,
            }
          : {
              code: loaded.result.code,
              message: this.localize(
                "Configuration version {0} is newer than this extension supports",
                loaded.result.version,
              ),
            };
    }
  }

  accept(result: OperationResult): void {
    if (result.kind === "committed" || result.kind === "no-change") {
      this.kind = "loaded";
      this.snapshot = result.snapshot;
      this.diagnostic = undefined;
    }
  }

  async keyForUri(uri: vscode.Uri): Promise<string> {
    return noteKeyForTarget(this.folder.uri.fsPath, uri.fsPath, {
      caseSensitive: this.caseSensitive,
      localize: this.localize,
    });
  }

  uriForKey(key: string): vscode.Uri {
    return key === "."
      ? this.folder.uri
      : vscode.Uri.file(path.join(this.folder.uri.fsPath, ...key.split("/")));
  }

  noteForKey(key: string): Note | undefined {
    return this.snapshot?.config.notes[key];
  }

  isConfigDocumentDirty(): boolean {
    return vscode.workspace.textDocuments.some(
      (document) =>
        document.isDirty &&
        path.resolve(document.uri.fsPath) === path.resolve(this.configPath),
    );
  }
}

interface Entry {
  state: WorkspaceNotesState;
  disposables: vscode.Disposable[];
}

export function lexicalNoteKey(
  root: string,
  target: string,
  localize: Localize = defaultLocalize,
): string {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    if (relative.length === 0) {
      return ".";
    }
    throw new PathPolicyError(localize("The target is outside the workspace root"));
  }
  const key = relative.split(path.sep).join("/");
  if (!isValidNoteKey(key)) {
    throw new PathPolicyError(localize("Invalid note key: {0}", key));
  }
  return key;
}

export class NotesWorkspaceManager implements vscode.Disposable {
  readonly #entries = new Map<string, Entry>();
  readonly #stylePreviews = new Map<WorkspaceNotesState, Map<string, NoteStyle>>();
  readonly #disposables: vscode.Disposable[] = [];
  readonly #onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.#onDidChangeEmitter.event;

  constructor(
    readonly repository: ConfigRepository,
    readonly localize: Localize = repository.localize,
  ) {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      this.#addFolder(folder);
    }
    this.#disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders((event) => {
        for (const folder of event.removed) {
          this.#removeFolder(folder);
        }
        for (const folder of event.added) {
          const state = this.#addFolder(folder);
          void state.refresh().then(() => this.notifyStateChanged());
        }
      }),
      vscode.workspace.onDidRenameFiles((event) => {
        void this.#handleRenames(event);
      }),
      this.#onDidChangeEmitter,
    );
  }

  async initialize(): Promise<void> {
    await Promise.all(this.allStates().map((state) => state.refresh()));
    this.notifyStateChanged();
  }

  allStates(): WorkspaceNotesState[] {
    return [...this.#entries.values()].map((entry) => entry.state);
  }

  stateForUri(uri: vscode.Uri): WorkspaceNotesState | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder === undefined
      ? undefined
      : this.#entries.get(folder.uri.toString())?.state;
  }

  notifyStateChanged(): void {
    this.#onDidChangeEmitter.fire();
  }

  previewedNoteStyle(
    state: WorkspaceNotesState,
    key: string,
  ): NoteStyle | undefined {
    return this.#stylePreviews.get(state)?.get(key);
  }

  setNoteStylePreview(
    state: WorkspaceNotesState,
    key: string,
    style: NoteStyle | undefined,
  ): void {
    if (style === undefined) {
      const previews = this.#stylePreviews.get(state);
      previews?.delete(key);
      if (previews?.size === 0) {
        this.#stylePreviews.delete(state);
      }
    } else {
      const previews = this.#stylePreviews.get(state) ?? new Map<string, NoteStyle>();
      previews.set(key, style);
      this.#stylePreviews.set(state, previews);
    }
    this.notifyStateChanged();
  }

  async refreshAll(): Promise<void> {
    await Promise.all(this.allStates().map((state) => state.refresh()));
    this.notifyStateChanged();
  }

  dispose(): void {
    for (const folder of [...this.#entries.values()]) {
      folder.disposables.forEach((disposable) => disposable.dispose());
    }
    this.#entries.clear();
    this.#stylePreviews.clear();
    this.#disposables.forEach((disposable) => disposable.dispose());
  }

  #addFolder(folder: vscode.WorkspaceFolder): WorkspaceNotesState {
    const existing = this.#entries.get(folder.uri.toString());
    if (existing !== undefined) {
      return existing.state;
    }
    const state = new WorkspaceNotesState(folder, this.repository, this.localize);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, ".codebase-notes.json"),
    );
    const refresh = (): void => {
      void state.refresh().then(() => this.notifyStateChanged());
    };
    const disposables = [
      watcher,
      watcher.onDidCreate(refresh),
      watcher.onDidChange(refresh),
      watcher.onDidDelete(refresh),
    ];
    this.#entries.set(folder.uri.toString(), { state, disposables });
    return state;
  }

  #removeFolder(folder: vscode.WorkspaceFolder): void {
    const entry = this.#entries.get(folder.uri.toString());
    entry?.disposables.forEach((disposable) => disposable.dispose());
    if (entry !== undefined) {
      this.#stylePreviews.delete(entry.state);
    }
    this.#entries.delete(folder.uri.toString());
    this.notifyStateChanged();
  }

  async #handleRenames(event: vscode.FileRenameEvent): Promise<void> {
    const grouped = new Map<
      WorkspaceNotesState,
      Array<{ oldPrefix: string; newPrefix: string }>
    >();

    for (const pair of event.files) {
      const oldState = this.stateForUri(pair.oldUri);
      const newState = this.stateForUri(pair.newUri);
      if (oldState === undefined || oldState !== newState) {
        continue;
      }
      try {
        const oldPrefix = lexicalNoteKey(
          oldState.folder.uri.fsPath,
          pair.oldUri.fsPath,
          this.localize,
        );
        const newPrefix = await oldState.keyForUri(pair.newUri);
        const moves = grouped.get(oldState) ?? [];
        moves.push({ oldPrefix, newPrefix });
        grouped.set(oldState, moves);
      } catch {
        // 路径不受支持时保留旧 note 为 missing，不进行猜测。
      }
    }

    for (const [state, moves] of grouped) {
      if (state.snapshot === undefined) {
        continue;
      }
      const result = await this.repository.moveMany(state.snapshot, moves);
      state.accept(result);
      if (result.kind === "conflict" || result.kind === "failed") {
        void vscode.window.showWarningMessage(
          result.kind === "conflict"
            ? this.localize(
                "Codebase Notes path migration conflict: {0}",
                result.paths.join(", "),
              )
            : this.localize(
                "Codebase Notes path migration failed: {0}",
                result.message,
              ),
        );
      }
    }
    this.notifyStateChanged();
  }
}
