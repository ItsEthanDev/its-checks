import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect } from "effect";
import { parseAllDocuments } from "yaml";

import { isArray, isObject } from "../documents.ts";
import type { BundleError } from "./bundle-errors.ts";
import {
  checkPath,
  compare,
  directory,
  fail,
  io,
  json,
  readText,
  unique,
  validate,
  type Context,
} from "./bundle-io.ts";
import type { BundleInfo, JsonValue, LoadedBundle, NativeFile } from "./bundle-types.ts";

function parseNative(
  ctx: Context,
  common: { path: string; source: string; content: string; executable: boolean },
): Effect.Effect<NativeFile, BundleError> {
  return Effect.gen(function* () {
    const { content, path: target } = common;
    const extension = path.posix.extname(target).toLowerCase();
    if (extension === ".json" || extension === ".jsonc") {
      const value = yield* json(ctx, content, extension === ".jsonc");
      yield* validate(ctx, "$", isObject(value), "Native JSON configuration must be an object");
      return {
        ...common,
        format: extension === ".json" ? ("json" as const) : ("jsonc" as const),
        value,
      };
    }
    if (extension === ".yaml" || extension === ".yml") {
      yield* Effect.try({
        try: () => {
          const documents = parseAllDocuments(content, { uniqueKeys: true });
          const errors = documents.flatMap((doc) => doc.errors);
          if (errors.length > 0) {
            throw new Error(errors.map((error) => error.message).join("; "));
          }
          if (documents.length !== 1) {
            throw new Error("Expected one YAML document");
          }
        },
        catch: (cause) => fail(ctx, "$", String(cause)),
      });
      return { ...common, format: "yaml" as const };
    }
    yield* validate(
      ctx,
      "$",
      extension === ".sh" || (extension === "" && target.startsWith(".husky/")),
      "Supported native formats: JSON, JSONC, YAML, .sh, and extensionless .husky hooks; executable installers are not supported",
    );
    yield* validate(ctx, "$", !content.includes("\0"), "Shell files cannot contain NUL");
    return { ...common, format: "shell" as const };
  });
}
function readNativeFiles(info: BundleInfo) {
  return Effect.gen(function* () {
    const files: NativeFile[] = [];
    const root = path.join(info.directory, "files");
    const walk = (relative: string): Effect.Effect<void, BundleError> =>
      Effect.gen(function* () {
        const ctx = { bundle: info.key, source: path.join(root, relative) };
        for (const name of yield* directory(ctx, relative === "")) {
          const target = relative.length > 0 ? `${relative}/${name}` : name;
          const child = { ...ctx, source: path.join(root, target) };
          yield* checkPath(child, "$", target);
          yield* validate(
            child,
            "$",
            name.toLowerCase() !== "package.json",
            "Declare package scripts/dependencies in bundle.json, not files/package.json",
          );
          const stat = yield* io(child, () => fs.lstat(child.source));
          if (stat.isDirectory()) {
            yield* walk(target);
            continue;
          }
          yield* validate(
            child,
            "$",
            stat.isFile(),
            "Only regular files and directories are supported; no symbolic links",
          );
          const content = yield* readText(child);
          files.push(
            yield* parseNative(child, {
              path: target,
              source: child.source,
              content,
              executable: (stat.mode & 0o111) !== 0,
            }),
          );
        }
      });
    yield* walk("");
    return files;
  });
}
function fieldAt(value: JsonValue | undefined, key: string | number): JsonValue | undefined {
  if (isArray(value) && typeof key === "number" && Object.hasOwn(value, key)) {
    return value[key];
  }
  if (isObject(value) && typeof key === "string" && Object.hasOwn(value, key)) {
    return value[key];
  }
  return undefined;
}
function checkBindings(info: BundleInfo, files: readonly NativeFile[]) {
  return Effect.gen(function* () {
    for (const [index, input] of (info.declaration.inputs ?? []).entries()) {
      const ctx = { bundle: info.key, source: info.source };
      const file = files.find((candidate) => candidate.path === input.destination.file);
      const nativeJson = file !== undefined && (file.format === "json" || file.format === "jsonc");
      yield* validate(
        ctx,
        `inputs[${index}].destination.file`,
        nativeJson,
        "Input destination must name this bundle's native JSON/JSONC file",
      );
      if (file !== undefined && (file.format === "json" || file.format === "jsonc")) {
        let value: JsonValue | undefined = file.value;
        for (const key of input.destination.field) {
          value = fieldAt(value, key);
        }
        yield* validate(
          ctx,
          `inputs[${index}].destination.field`,
          value !== undefined,
          `Destination field must exist in ${file.source}`,
        );
      }
    }
  });
}

/** Load native files without executing policy code. */
export function nativeFiles(info: BundleInfo): Effect.Effect<LoadedBundle, BundleError> {
  return Effect.gen(function* () {
    const files = yield* readNativeFiles(info);
    files.sort((a, b) => compare(a.path, b.path));
    yield* unique(
      { bundle: info.key, source: path.join(info.directory, "files") },
      "$",
      files.map((file) => file.path),
    );
    yield* checkBindings(info, files);
    return { ...info, files };
  });
}
