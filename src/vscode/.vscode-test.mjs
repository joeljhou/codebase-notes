import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@vscode/test-cli";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  {
    label: "integration",
    files: "integration/**/*.test.cjs",
    version: "1.107.1",
    workspaceFolder: path.join(root, ".vscode-test", "workspace"),
    extensionDevelopmentPath: root,
    launchArgs: [
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--user-data-dir",
      path.join(os.tmpdir(), "cbn-vscode-user"),
      "--extensions-dir",
      path.join(os.tmpdir(), "cbn-vscode-extensions")
    ],
    mocha: {
      ui: "bdd",
      timeout: 30000
    }
  }
]);
