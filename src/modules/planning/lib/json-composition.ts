import { canonical, isArray, isObject, type JsonObject } from "../../policy/documents.ts";
import type { JsonValue, NativeFile } from "../../policy/index.ts";
import { PlanError } from "./plan-errors.ts";

export function conflict(source: string, at: string, detail: string): never {
  throw new PlanError({ source, field: at, detail });
}
const pointer = (parent: string, key: string) =>
  `${parent}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
const keys = (at: string) =>
  at
    .slice(1)
    .split("/")
    .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
export function fieldAt(value: JsonValue, at: string): JsonValue | undefined {
  let result = value;
  for (const key of keys(at)) {
    const next = isObject(result) && Object.hasOwn(result, key) ? result[key] : undefined;
    if (next === undefined) {
      return undefined;
    }
    result = next;
  }
  return result;
}
export function field(value: JsonValue, at: string, source: string): JsonValue {
  const result = fieldAt(value, at);
  if (result === undefined) {
    return conflict(source, at, "Replacement field must exist and use object keys");
  }
  return result;
}
export function setField(
  value: JsonValue,
  at: string,
  replacement: JsonValue,
  source: string,
): JsonValue {
  const set = (node: JsonValue, remaining: readonly string[]): JsonValue => {
    const [key, ...rest] = remaining;
    if (
      !isObject(node) ||
      key === undefined ||
      !Object.hasOwn(node, key) ||
      node[key] === undefined
    ) {
      return conflict(source, at, "Missing replacement field");
    }
    return { ...node, [key]: rest.length === 0 ? replacement : set(node[key], rest) };
  };
  return set(value, keys(at));
}
const unique = (values: readonly JsonValue[]) =>
  values.filter(
    (entry, index) => values.findIndex((other) => canonical(other) === canonical(entry)) === index,
  );
export interface MergeContext {
  readonly arrays: NativeFile["arrays"];
  readonly source: string;
}
export function merge(a: JsonValue, b: JsonValue, context: MergeContext, at = ""): JsonValue {
  if (isObject(a) && isObject(b)) {
    const result: Record<string, JsonValue> = { ...a };
    for (const [key, value] of Object.entries(b)) {
      const previous = Object.hasOwn(a, key) ? a[key] : undefined;
      result[key] =
        previous === undefined ? value : merge(previous, value, context, pointer(at, key));
    }
    return result;
  }
  if (context.arrays[at] === "append-unique" && isArray(a) && isArray(b)) {
    return unique([...a, ...b]);
  }
  if (canonical(a) === canonical(b)) {
    return a;
  }
  return conflict(
    context.source,
    at.length === 0 ? "$" : at,
    "Incompatible contributions; no selection-order winner",
  );
}
/** Remove only declared leaves/items, without retaining an output baseline. */
function subtractObject(
  target: JsonObject,
  prior: JsonObject,
  arrays: NativeFile["arrays"],
  at: string,
) {
  const result: Record<string, JsonValue> = { ...target };
  for (const [key, value] of Object.entries(prior)) {
    const current = Object.hasOwn(result, key) ? result[key] : undefined;
    if (current === undefined) {
      continue;
    }
    const next = subtract(current, value, arrays, pointer(at, key));
    if (next === undefined) {
      delete result[key];
    } else {
      result[key] = next;
    }
  }
  return Object.keys(result).length === 0 && Object.keys(prior).length > 0 ? undefined : result;
}
function subtract(
  target: JsonValue,
  prior: JsonValue,
  arrays: NativeFile["arrays"],
  at = "",
): JsonValue | undefined {
  if (isObject(prior) && isObject(target)) {
    return subtractObject(target, prior, arrays, at);
  }
  if (arrays[at] === "append-unique" && isArray(target) && isArray(prior)) {
    return target.filter((item) => !prior.some((old) => canonical(old) === canonical(item)));
  }
  return undefined;
}
function overlay(
  target: JsonValue,
  selected: JsonValue,
  arrays: NativeFile["arrays"],
  at = "",
): JsonValue {
  if (isObject(target) && isObject(selected)) {
    const result: Record<string, JsonValue> = { ...target };
    for (const [key, value] of Object.entries(selected)) {
      const previous = Object.hasOwn(result, key) ? result[key] : undefined;
      result[key] =
        previous === undefined ? value : overlay(previous, value, arrays, pointer(at, key));
    }
    return result;
  }
  if (arrays[at] === "append-unique" && isArray(target) && isArray(selected)) {
    return unique([...target, ...selected]);
  }
  return selected;
}
function composing(
  file: NativeFile | undefined,
): file is NativeFile & { readonly format: "json" | "jsonc"; readonly value: JsonValue } {
  return file?.operation === "compose" && file.format !== "text";
}
export function composeTarget(
  target: JsonValue,
  current?: NativeFile,
  prior?: NativeFile,
): JsonObject {
  if (!isObject(target)) {
    return conflict(
      current?.source ?? prior?.source ?? "target",
      "$",
      "Compose requires an object target",
    );
  }
  let result: JsonValue = target;
  if (composing(prior)) {
    result = subtract(result, prior.value, prior.arrays) ?? {};
  }
  if (composing(current)) {
    result = overlay(result, current.value, current.arrays);
  }
  if (!isObject(result)) {
    return conflict(current?.source ?? "target", "$", "Compose contributions must be objects");
  }
  return result;
}
