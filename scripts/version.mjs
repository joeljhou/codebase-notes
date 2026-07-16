import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// VERSION 是唯一版本源；VS Code 清单和 lockfile 只是必须同步的派生值。
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const versionFile = path.join(projectRoot, "VERSION");
const vscodePackageFile = path.join(
  projectRoot,
  "src",
  "vscode",
  "package.json",
);
const vscodeLockFile = path.join(
  projectRoot,
  "src",
  "vscode",
  "package-lock.json",
);

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

async function readVersion() {
  const version = (await readFile(versionFile, "utf8")).trim();
  if (!semverPattern.test(version)) {
    throw new Error(`Invalid VERSION value: ${version}`);
  }
  return version;
}

async function writeAtomic(file, contents) {
  const temporaryFile = `${file}.tmp`;
  await writeFile(temporaryFile, contents, "utf8");
  await rename(temporaryFile, file);
}

async function versionMismatches(version) {
  const packageJson = await readJson(vscodePackageFile);
  const packageLock = await readJson(vscodeLockFile);
  const mismatches = [];

  if (packageJson.version !== version) {
    mismatches.push(`src/vscode/package.json=${packageJson.version}`);
  }
  if (packageLock.version !== version) {
    mismatches.push(`src/vscode/package-lock.json=${packageLock.version}`);
  }
  if (packageLock.packages?.[""]?.version !== version) {
    mismatches.push(
      `src/vscode/package-lock.json#packages[""]=${packageLock.packages?.[""]?.version}`,
    );
  }
  return mismatches;
}

async function writeDerivedVersion(version) {
  const packageJson = await readJson(vscodePackageFile);
  const packageLock = await readJson(vscodeLockFile);
  packageJson.version = version;
  packageLock.version = version;
  packageLock.packages[""].version = version;

  await writeAtomic(
    vscodePackageFile,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  await writeAtomic(
    vscodeLockFile,
    `${JSON.stringify(packageLock, null, 2)}\n`,
  );
}

const command = process.argv[2] ?? "get";
const argument = process.argv[3];
const quiet = process.argv.includes("--quiet");
const raw = process.argv.includes("--raw");

try {
  switch (command) {
  case "get": {
    const version = await readVersion();
    console.log(raw ? version : `Version: ${version}`);
    break;
  }
  case "check": {
    const version = await readVersion();
    const mismatches = await versionMismatches(version);
    if (mismatches.length > 0) {
      throw new Error(
        `Version mismatch. Run ./deploy.sh version ${version}.\n${mismatches.join("\n")}`,
      );
    }
    if (!quiet) console.log(`Version check passed: ${version}`);
    break;
  }
  case "sync": {
    const version = await readVersion();
    const mismatches = await versionMismatches(version);
    if (mismatches.length > 0) {
      await writeDerivedVersion(version);
      if (!quiet) console.log(`Version synchronized: ${version}`);
    } else if (!quiet) {
      console.log(`Version already synchronized: ${version}`);
    }
    break;
  }
  case "set": {
    if (!argument || !semverPattern.test(argument)) {
      throw new Error(`Invalid semantic version: ${argument ?? ""}`);
    }

    await writeAtomic(versionFile, `${argument}\n`);
    await writeDerivedVersion(argument);
    console.log(`Version updated: ${argument}`);
    break;
  }
    default:
      throw new Error(`Unknown version command: ${command}`);
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
