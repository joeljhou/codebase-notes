import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.join(root, ".vscode-test", "workspace");

await rm(workspace, { recursive: true, force: true });
await Promise.all([
  rm(path.join(os.tmpdir(), "cbn-vscode-user"), {
    recursive: true,
    force: true
  }),
  rm(path.join(os.tmpdir(), "cbn-vscode-extensions"), {
    recursive: true,
    force: true
  })
]);
await mkdir(path.join(workspace, "src"), { recursive: true });
await writeFile(path.join(workspace, "src", "App.ts"), "export const app = true;\n");
await writeFile(path.join(workspace, "README.md"), "# Integration Fixture\n");
