import type { JsonObject } from "./types.js";

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ownValue<T>(value: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

export function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
