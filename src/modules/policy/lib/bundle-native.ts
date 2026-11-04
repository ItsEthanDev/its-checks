import * as path from "node:path";

import { Effect } from "effect";

import { isObject } from "../documents.ts";
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
/** Load explicitly declared UTF-8 contributions, never code or filename conventions. */
export function nativeFiles(info: BundleInfo): Effect.Effect<LoadedBundle, BundleError> {
  return Effect.gen(function* () {
    const files: NativeFile[] = yield* Effect.forEach(info.declaration.files ?? [], (declaration) =>
      readFile(info, declaration),
    );
    for (const input of info.declaration.inputs ?? []) {
      const file = files.find((candidate) => candidate.path === input.destination.file);
      yield* validate(
        { bundle: info.key, source: info.source },
        "inputs.destination",
        file !== undefined && file.format !== "text",
        "Input destinations must name a declared JSON/JSONC contribution",
      );
    }
    return { ...info, files };
  });
}
