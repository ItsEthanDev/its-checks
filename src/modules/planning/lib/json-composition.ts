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
  readonly fields: NativeFile["fields"];
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
  if (context.fields[at]?.merge === "append-unique" && isArray(a) && isArray(b)) {
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
interface Cleanup {
  readonly prior: NativeFile;
  readonly current: NativeFile | undefined;
}
function subtractObject(target: JsonObject, prior: JsonObject, context: Cleanup, at: string) {
  const result: Record<string, JsonValue> = { ...target };
  let removed = false;
  for (const [key, value] of Object.entries(prior)) {
    const current = Object.hasOwn(result, key) ? result[key] : undefined;
    if (current === undefined) {
      continue;
    }
    const next = subtract(current, value, context, pointer(at, key));
    if (next === undefined) {
      delete result[key];
      removed = true;
    } else {
      result[key] = next;
    }
  }
  return Object.keys(result).length === 0 && removed ? undefined : result;
}
function handedOff(current: NativeFile | undefined, prior: JsonValue, at: string) {
  if (current === undefined || current.format === "text" || current.fields[at]?.mode !== "seed") {
    return false;
  }
  const selected = fieldAt(current.value, at);
  return selected !== undefined && (!isObject(selected) || !isObject(prior));
}
function subtract(
  target: JsonValue,
  prior: JsonValue,
  context: Cleanup,
  at = "",
): JsonValue | undefined {
  if (handedOff(context.current, prior, at)) {
    return target;
  }
  if (isObject(prior) && isObject(target)) {
    return subtractObject(target, prior, context, at);
  }
  if (context.prior.fields[at]?.mode === "seed") {
    return target;
  }
  if (context.prior.fields[at]?.merge === "append-unique" && isArray(target) && isArray(prior)) {
    return target.filter((item) => !prior.some((old) => canonical(old) === canonical(item)));
  }
  return undefined;
}
function overlay(
  target: JsonValue | undefined,
  selected: JsonValue,
  file: NativeFile,
  at = "",
): JsonValue {
  if ((target === undefined || isObject(target)) && isObject(selected)) {
    const result: Record<string, JsonValue> = { ...target };
    for (const [key, value] of Object.entries(selected)) {
      const previous = Object.hasOwn(result, key) ? result[key] : undefined;
      result[key] = overlay(previous, value, file, pointer(at, key));
    }
    return result;
  }
  if (target !== undefined && file.fields[at]?.mode === "seed") {
    return target;
  }
  if (file.fields[at]?.merge === "append-unique" && isArray(selected)) {
    return unique([...(isArray(target) ? target : []), ...selected]);
  }
  return selected;
}
function checkStructure(target: JsonValue, selected: JsonValue, file: NativeFile, at = "") {
  if (isObject(selected)) {
    if (!isObject(target)) {
      conflict(
        file.source,
        at.length === 0 ? "$" : at,
        "Cannot compose fields into a non-object project value",
      );
    }
    for (const [key, value] of Object.entries(selected)) {
      const existing = Object.hasOwn(target, key) ? target[key] : undefined;
      if (existing !== undefined) {
        checkStructure(existing, value, file, pointer(at, key));
      }
    }
  } else if (file.fields[at]?.merge === "append-unique" && !isArray(target)) {
    conflict(file.source, at, "Cannot append items to a non-array project value");
  }
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
  if (composing(current)) {
    checkStructure(target, current.value, current);
  }
  if (composing(prior)) {
    result = subtract(result, prior.value, { prior, current }) ?? {};
  }
  if (composing(current)) {
    result = overlay(result, current.value, current);
  }
  if (!isObject(result)) {
    return conflict(current?.source ?? "target", "$", "Compose contributions must be objects");
  }
  return result;
}
