export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type NoteStyle =
  | "default"
  | "important"
  | "focus"
  | "core"
  | "stable"
  | "extension";

export interface Note extends JsonObject {
  text: string;
  style?: NoteStyle;
}

export interface ConfigV1 extends JsonObject {
  version: 1;
  notes: Record<string, Note>;
  $schema?: string;
}

export type DiagnosticCode =
  | "CBN001_INVALID_CONFIG"
  | "CBN002_FUTURE_VERSION"
  | "CBN003_WRITE_CONFLICT"
  | "CBN004_LOCKED"
  | "CBN005_MISSING"
  | "CBN006_ALIAS_CONFLICT"
  | "CBN007_UNSAFE_CONFIG"
  | "CBN008_LOCKFILE_TRACKED";

export interface WritableConfig {
  mode: "writable-v1";
  config: ConfigV1;
}

export interface FutureConfig {
  mode: "readonly-future";
  code: "CBN002_FUTURE_VERSION";
  version: number;
}

export interface InvalidConfig {
  mode: "invalid";
  code: "CBN001_INVALID_CONFIG";
  message: string;
}

export type ConfigLoadResult = WritableConfig | FutureConfig | InvalidConfig;
