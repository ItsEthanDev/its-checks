import type { JsonValue } from "./lib/bundle-types.ts";

/** JSON/JSONC documents and target-relative paths shared by policy consumers. */
export { json, safePath } from "./lib/bundle-io.ts";

export type JsonObject = { readonly [key: string]: JsonValue };
export const isObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const isArray = (value: JsonValue | undefined): value is readonly JsonValue[] =>
  Array.isArray(value);
export const canonical = (value: JsonValue): string => JSON.stringify(ordered(value));
function ordered(value: JsonValue): JsonValue {
  if (isArray(value)) {
    return value.map(ordered);
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => {
          if (a === b) {
            return 0;
          }
          return a < b ? -1 : 1;
        })
        .map(([key, entry]) => [key, ordered(entry)]),
    );
  }
  return value;
}
export const jsonContent = (value: JsonValue): string =>
  `${JSON.stringify(ordered(value), null, 2)}\n`;
