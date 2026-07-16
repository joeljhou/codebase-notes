import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  parse,
  printParseErrorCode,
  visit,
  type ParseError,
} from "jsonc-parser";
import type {
  ConfigLoadResult,
  ConfigV1,
  JsonObject,
  JsonValue,
} from "./types.js";
import { defaultLocalize, type Localize } from "./localize.js";

const PARSE_OPTIONS = {
  allowEmptyContent: false,
  allowTrailingComma: false,
  disallowComments: true,
} as const;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSchemaError(error: ErrorObject, localize: Localize): string {
  const location = error.instancePath.length === 0 ? "/" : error.instancePath;
  return localize(
    "Schema error at {0}: {1}",
    location,
    error.message ?? error.keyword,
  );
}

function findDuplicateKey(text: string): string | undefined {
  const objectKeys: Array<Set<string>> = [];
  let duplicate: string | undefined;

  visit(
    text,
    {
      onObjectBegin: () => {
        objectKeys.push(new Set());
      },
      onObjectProperty: (property) => {
        const keys = objectKeys.at(-1);
        if (keys?.has(property)) {
          duplicate ??= property;
        }
        keys?.add(property);
      },
      onObjectEnd: () => {
        objectKeys.pop();
      },
    },
    PARSE_OPTIONS,
  );
  return duplicate;
}

function validateNumbers(
  value: JsonValue,
  localize: Localize,
  path = "$",
): string | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return localize("{0} is not a finite number", path);
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      return localize(
        "{0} exceeds the JavaScript safe integer range; use a string instead",
        path,
      );
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const error = validateNumbers(child, localize, `${path}[${index}]`);
      if (error !== undefined) {
        return error;
      }
    }
    return undefined;
  }
  if (isJsonObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const error = validateNumbers(child, localize, `${path}.${key}`);
      if (error !== undefined) {
        return error;
      }
    }
  }
  return undefined;
}

export class ConfigParser {
  readonly #validateV1: ValidateFunction;

  constructor(
    schema: object,
    readonly localize: Localize = defaultLocalize,
  ) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    this.#validateV1 = ajv.compile(schema);
  }

  parse(input: string | Uint8Array): ConfigLoadResult {
    const decoded =
      typeof input === "string" ? input : Buffer.from(input).toString("utf8");
    const text = decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
    const errors: ParseError[] = [];
    const value: unknown = parse(text, errors, PARSE_OPTIONS);

    if (errors.length > 0) {
      const first = errors[0];
      return {
        mode: "invalid",
        code: "CBN001_INVALID_CONFIG",
        message:
          first === undefined
            ? this.localize("Failed to parse JSON")
            : this.localize(
                "Failed to parse JSON: {0} at offset {1}",
                printParseErrorCode(first.error),
                first.offset,
              ),
      };
    }

    const duplicate = findDuplicateKey(text);
    if (duplicate !== undefined) {
      return {
        mode: "invalid",
        code: "CBN001_INVALID_CONFIG",
        message: this.localize("Duplicate object key: {0}", duplicate),
      };
    }

    if (!isJsonObject(value)) {
      return {
        mode: "invalid",
        code: "CBN001_INVALID_CONFIG",
        message: this.localize("The configuration root must be a JSON object"),
      };
    }

    const version = value.version;
    if (
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      return {
        mode: "invalid",
        code: "CBN001_INVALID_CONFIG",
        message: this.localize("version must be an integer greater than or equal to 1"),
      };
    }

    // 高版本只判断 version，不拿 v1 Schema 猜测未来数据结构。
    if (version > 1) {
      return {
        mode: "readonly-future",
        code: "CBN002_FUTURE_VERSION",
        version,
      };
    }

    if (!this.#validateV1(value)) {
      return {
        mode: "invalid",
        code: "CBN001_INVALID_CONFIG",
        message: (this.#validateV1.errors ?? [])
          .map((error) => formatSchemaError(error, this.localize))
          .join("; "),
      };
    }

    const numberError = validateNumbers(value, this.localize);
    if (numberError !== undefined) {
      return {
        mode: "invalid",
        code: "CBN001_INVALID_CONFIG",
        message: numberError,
      };
    }

    return {
      mode: "writable-v1",
      config: value as ConfigV1,
    };
  }
}
