import { Effect } from "effect";

import type { JsonValue, LoadedBundle, LoadedPolicy } from "./bundles.ts";
import { PlanError } from "./plan-errors.ts";

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
const rank = { base: 0, integration: 1, automation: 2 };
export const orderedBundles = (bundles: readonly LoadedBundle[]): readonly LoadedBundle[] =>
  bundles.toSorted((a, b) => {
    const difference = rank[a.kind] - rank[b.kind];
    if (difference !== 0) {
      return difference;
    }
    if (a.id === b.id) {
      return 0;
    }
    return a.id < b.id ? -1 : 1;
  });
export const configDestination = (
  relative: string,
): ".oxfmtrc.json" | ".oxlintrc.json" | undefined => {
  if (relative === ".oxfmtrc.json" || relative === ".oxfmtrc.jsonc") {
    return ".oxfmtrc.json";
  }
  if (relative === ".oxlintrc.json" || relative === ".oxlintrc.jsonc") {
    return ".oxlintrc.json";
  }
  return undefined;
};

/** Installer composition only; never evaluates tool inheritance or existing target configuration. */
export function composeConfigurations(
  policy: LoadedPolicy,
): Effect.Effect<Readonly<Record<".oxfmtrc.json" | ".oxlintrc.json", JsonObject>>, PlanError> {
  return Effect.gen(function* () {
    const outputs: Record<".oxfmtrc.json" | ".oxlintrc.json", Record<string, JsonValue>> = {
      ".oxfmtrc.json": {},
      ".oxlintrc.json": {},
    };
    for (const bundle of orderedBundles(policy.bundles)) {
      const seen = new Set<string>();
      for (const file of bundle.files) {
        const destination = configDestination(file.path);
        if (destination === undefined) {
          continue;
        }
        const fail = (field: string, detail: string) =>
          Effect.fail(new PlanError({ source: file.source, field, detail }));
        if (seen.has(destination)) {
          return yield* fail(
            "$",
            `One bundle cannot supply both JSON and JSONC for ${destination}`,
          );
        }
        seen.add(destination);
        if (!("value" in file) || !isObject(file.value)) {
          return yield* fail("$", "Expected a native JSON/JSONC object");
        }
        yield* mergeConfiguration(outputs[destination], file.value, {
          lint: destination === ".oxlintrc.json",
          source: file.source,
        });
      }
    }
    return outputs;
  });
}

function mergeConfiguration(
  output: Record<string, JsonValue>,
  fragment: JsonObject,
  context: { lint: boolean; source: string },
) {
  return Effect.gen(function* () {
    const { lint, source } = context;
    const fail = (field: string, detail: string) =>
      Effect.fail(new PlanError({ source, field, detail }));
    for (const [field, value] of Object.entries(fragment)) {
      const mode = compositionMode(field, lint);
      if (mode === "unsupported") {
        return yield* fail(field, "Oxfmt extends is not an installer-supported field");
      }
      if (mode === "object") {
        if (!isObject(value)) {
          return yield* fail(field, "Expected an object; entries compose by key as whole values");
        }
        const previous = output[field];
        output[field] = { ...(isObject(previous) ? previous : {}), ...value };
      } else if (mode === "array") {
        if (!isArray(value)) {
          return yield* fail(field, "Expected an array");
        }
        const previous = output[field];
        const combined = [...(isArray(previous) ? previous : []), ...value];
        output[field] =
          field === "overrides"
            ? combined
            : combined.filter(
                (entry, index) =>
                  combined.findIndex((other) => canonical(other) === canonical(entry)) === index,
              );
      } else {
        // Every other top-level field is atomic, including formatter option objects and arrays.
        output[field] = value;
      }
    }
    return undefined;
  });
}

function compositionMode(field: string, lint: boolean) {
  if (!lint && field === "extends") {
    return "unsupported";
  }
  if (lint && ["rules", "categories", "env", "globals", "settings", "options"].includes(field)) {
    return "object";
  }
  if (
    field === "overrides" ||
    field === "ignorePatterns" ||
    (lint && ["plugins", "jsPlugins", "extends"].includes(field))
  ) {
    return "array";
  }
  return "atomic";
}
