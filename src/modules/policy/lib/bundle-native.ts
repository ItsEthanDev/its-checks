import * as path from "node:path";

import { Effect } from "effect";

import { canonical, isArray, isObject } from "../documents.ts";
import type { BundleError } from "./bundle-errors.ts";
import { directory, json, readText, validate, type Context } from "./bundle-io.ts";
import type {
  BundleInfo,
  FileDeclaration,
  JsonValue,
  LoadedBundle,
  NativeFile,
} from "./bundle-types.ts";

function checkComposition(ctx: Context, declaration: FileDeclaration, value: JsonValue) {
  return Effect.gen(function* () {
    if (declaration.operation !== "compose") {
      return undefined;
    }
    yield* validate(ctx, "$", isObject(value), "Compose contributions must be objects");
    for (const pointer of Object.keys(declaration.arrays ?? {})) {
      let field: unknown = value;
      const keys = pointer
        .slice(1)
        .split("/")
        .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
      for (const key of keys) {
        field = isObject(field) && Object.hasOwn(field, key) ? field[key] : undefined;
      }
      yield* validate(
        ctx,
        pointer,
        field === undefined || Array.isArray(field),
        "Declared array operation requires an array",
      );
    }
    return undefined;
  });
}
function readFile(info: BundleInfo, declaration: FileDeclaration) {
  return Effect.gen(function* () {
    const source = path.join(info.directory, declaration.source);
    const ctx = { bundle: info.key, source };
    const parts = declaration.source.split("/");
    for (let index = 1; index < parts.length; index++) {
      yield* directory({ ...ctx, source: path.join(info.directory, ...parts.slice(0, index)) });
    }
    const content = yield* readText(ctx);
    const common = {
      path: declaration.target,
      source,
      content,
      executable: declaration.executable ?? false,
      operation: declaration.operation,
      arrays: declaration.arrays ?? {},
      replaces: declaration.replaces ?? {},
    };
    if (declaration.format === undefined) {
      return { ...common, format: "text" as const };
    }
    const value = yield* json(ctx, content, declaration.format === "jsonc");
    yield* checkComposition(ctx, declaration, value);
    return { ...common, format: declaration.format, value };
  });
}
type Input = NonNullable<BundleInfo["declaration"]["inputs"]>[number];
function checkDestination(info: BundleInfo, files: readonly NativeFile[], input: Input) {
  return Effect.gen(function* () {
    const ctx = { bundle: info.key, source: info.source };
    const field = `inputs.${input.id}.destination`;
    const file = files.find((candidate) => candidate.path === input.destination.file);
    if (file === undefined || file.format === "text") {
      return yield* validate(
        ctx,
        field,
        false,
        `Expected this bundle's JSON/JSONC file: ${input.destination.file}`,
      );
    }
    let value: JsonValue | undefined = file.value;
    for (const key of input.destination.field) {
      yield* validate(
        ctx,
        field,
        value !== null &&
          typeof value === "object" &&
          (Array.isArray(value) ? typeof key === "number" : typeof key === "string") &&
          Object.hasOwn(value, key),
        `Destination field ${canonical(input.destination.field)} must exist with object keys/array indexes in ${file.source}`,
      );
      if (isArray(value) && typeof key === "number") {
        value = value[key];
      } else if (isObject(value) && typeof key === "string") {
        value = value[key];
      }
    }
    return undefined;
  });
}
/** Load explicitly declared UTF-8 contributions and validate their input destinations. */
export function nativeFiles(info: BundleInfo): Effect.Effect<LoadedBundle, BundleError> {
  return Effect.gen(function* () {
    const files: NativeFile[] = yield* Effect.forEach(info.declaration.files ?? [], (declaration) =>
      readFile(info, declaration),
    );
    const inputs = info.declaration.inputs ?? [];
    for (const [index, input] of inputs.entries()) {
      yield* checkDestination(info, files, input);
      for (const other of inputs.slice(0, index)) {
        const a = input.destination;
        const b = other.destination;
        const overlaps =
          a.file === b.file &&
          a.field
            .slice(0, Math.min(a.field.length, b.field.length))
            .every((key, i) => key === b.field[i]);
        yield* validate(
          { bundle: info.key, source: info.source },
          `inputs.${input.id}.destination`,
          !overlaps,
          `Overlapping input destinations: ${other.id} and ${input.id}`,
        );
      }
    }
    return { ...info, files };
  });
}
