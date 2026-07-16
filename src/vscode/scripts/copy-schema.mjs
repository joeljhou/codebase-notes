import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const adapterRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const projectRoot = path.resolve(adapterRoot, "..", "..");
const resources = path.join(adapterRoot, "resources");

await mkdir(resources, { recursive: true });
await copyFile(
  path.join(projectRoot, "spec", "codebase-notes.schema.json"),
  path.join(resources, "codebase-notes.schema.json"),
);
