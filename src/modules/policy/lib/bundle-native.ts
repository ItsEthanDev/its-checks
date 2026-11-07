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
    const fields: Record<string, NativeFile["fields"][string]> = {};
    if (declaration.operation !== "compose") {
      return fields;
    }
    yield* validate(ctx, "$", isObject(value), "Compose contributions must be objects");
    const values = new Map<string, JsonValue>();
    const visit = (node: JsonValue, at: string, inherited: "seed" | "replace") => {
      const options = declaration.fields?.[at];
      const mode = options?.mode ?? inherited;
      if (at !== "") {
        fields[at] = { ...options, mode };
        values.set(at, node);
      }
      if (isObject(node)) {
        for (const [key, child] of Object.entries(node)) {
          visit(child, `${at}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, mode);
        }
      }
    };
    visit(value, "", declaration.defaultMode ?? "replace");
    for (const [pointer, options] of Object.entries(declaration.fields ?? {})) {
      const field = values.get(pointer);
      yield* validate(
        ctx,
        pointer,
        field !== undefined,
        "Declared field must exist and use object keys",
      );
      if (options.merge !== undefined) {
        yield* validate(
          ctx,
          pointer,
          Array.isArray(field),
          "Declared array operation requires an array",
        );
        yield* validate(
          ctx,
          pointer,
          fields[pointer]?.mode === "replace",
          "append-unique requires replace mode",
        );
      }
    }
    return fields;
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
    };
    if (declaration.format === undefined) {
      return { ...common, fields: {}, format: "text" as const };
    }
    const value = yield* json(ctx, content, declaration.format === "jsonc");
    const fields = yield* checkComposition(ctx, declaration, value);
    return { ...common, fields, format: declaration.format, value };
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
