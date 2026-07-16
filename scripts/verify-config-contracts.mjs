import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromVscode = createRequire(
  path.join(root, "src", "vscode", "package.json"),
);
const Ajv2020 = requireFromVscode("ajv/dist/2020.js").default;
const addFormats = requireFromVscode("ajv-formats").default;
const schemaPath = path.join(root, "spec", "codebase-notes.schema.json");
const examplesDirectory = path.join(root, "spec", "examples");
const conformanceDirectory = path.join(root, "spec", "conformance");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const schema = await readJson(schemaPath);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const exampleFiles = (await readdir(examplesDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();

for (const name of exampleFiles) {
  const value = await readJson(path.join(examplesDirectory, name));
  if (!validate(value)) {
    throw new Error(
      `示例 ${name} 不符合 Schema：${ajv.errorsText(validate.errors)}`,
    );
  }
}

const fixtureFiles = (await readdir(conformanceDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
const ids = new Set();
let caseCount = 0;

for (const name of fixtureFiles) {
  const fixture = await readJson(path.join(conformanceDirectory, name));
  if (!Array.isArray(fixture.cases)) {
    throw new Error(`fixture ${name} 缺少 cases 数组`);
  }
  for (const testCase of fixture.cases) {
    if (typeof testCase.id !== "string" || testCase.id.length === 0) {
      throw new Error(`fixture ${name} 存在空 id`);
    }
    if (ids.has(testCase.id)) {
      throw new Error(`fixture id 重复：${testCase.id}`);
    }
    ids.add(testCase.id);
    caseCount += 1;
  }
}

console.log(
  `Schema 验证通过：${exampleFiles.length} 个示例，${fixtureFiles.length} 份 fixture，${caseCount} 个 case`,
);
