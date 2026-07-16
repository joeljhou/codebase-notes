import { readFileSync } from "node:fs";
import path from "node:path";
import { ConfigParser } from "../core/parser.js";

export function createParser(): ConfigParser {
  const schemaPath = path.resolve(
    __dirname,
    "..",
    "..",
    "resources",
    "codebase-notes.schema.json",
  );
  return new ConfigParser(JSON.parse(readFileSync(schemaPath, "utf8")) as object);
}

export function projectRoot(): string {
  return path.resolve(__dirname, "..", "..", "..", "..");
}
