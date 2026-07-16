import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { mergeNotes, type NoteIntent, type NoteMap } from "../core/merge.js";
import { planMove } from "../core/move.js";
import { isValidNoteKey } from "../core/path-policy.js";
import {
  compareUnicodeScalars,
  stableSerialize,
} from "../core/serializer.js";
import type { ConfigV1, Note } from "../core/types.js";
import { createParser, projectRoot } from "./helpers.js";

interface FixtureCase {
  id: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

interface Fixture {
  operation: string;
  cases: FixtureCase[];
}

const fixturesDirectory = path.join(projectRoot(), "spec", "conformance");
const parser = createParser();

for (const file of readdirSync(fixturesDirectory).filter((name) =>
  name.endsWith(".json"),
)) {
  const fixture = JSON.parse(
    readFileSync(path.join(fixturesDirectory, file), "utf8"),
  ) as Fixture;

  for (const fixtureCase of fixture.cases) {
    test(fixtureCase.id, () => {
      switch (fixture.operation) {
        case "parse-config": {
          const result = parser.parse(String(fixtureCase.input.text));
          const actual: Record<string, unknown> = { mode: result.mode };
          if ("code" in result) {
            actual.code = result.code;
          }
          assert.deepEqual(actual, fixtureCase.expected);
          break;
        }
        case "parse-generated-note": {
          const text = String(fixtureCase.input.character).repeat(
            Number(fixtureCase.input.count),
          );
          const result = parser.parse(
            JSON.stringify({ version: 1, notes: { "a.ts": { text } } }),
          );
          const actual: Record<string, unknown> = { mode: result.mode };
          if ("code" in result) actual.code = result.code;
          assert.deepEqual(actual, fixtureCase.expected);
          break;
        }
        case "validate-key": {
          assert.deepEqual(
            { valid: isValidNoteKey(String(fixtureCase.input.key)) },
            fixtureCase.expected,
          );
          break;
        }
        case "sort-keys": {
          const keys = [...(fixtureCase.input.keys as string[])].sort(
            compareUnicodeScalars,
          );
          assert.deepEqual({ keys }, fixtureCase.expected);
          break;
        }
        case "serialize-config": {
          assert.deepEqual(
            {
              text: stableSerialize(
                fixtureCase.input.config as unknown as ConfigV1,
              ),
            },
            fixtureCase.expected,
          );
          break;
        }
        case "merge": {
          const result = mergeNotes(
            fixtureCase.input.base as NoteMap,
            fixtureCase.input.disk as NoteMap,
            fixtureCase.input.intent as NoteIntent,
          );
          assert.deepEqual(result, fixtureCase.expected);
          break;
        }
        case "move": {
          const result = planMove(
            fixtureCase.input.notes as Record<string, Note>,
            String(fixtureCase.input.oldPrefix),
            String(fixtureCase.input.newPrefix),
          );
          assert.deepEqual(result, fixtureCase.expected);
          break;
        }
        default:
          assert.fail(`未知 fixture operation：${fixture.operation}`);
      }
    });
  }
}
