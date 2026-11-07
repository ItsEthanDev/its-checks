import { Effect } from "effect";

import type { BundleError } from "./bundle-errors.ts";
import { checkPath, unique, validate, type Context } from "./bundle-io.ts";
import type { BundleDeclaration, FileDeclaration } from "./bundle-types.ts";

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
type Input = NonNullable<BundleDeclaration["inputs"]>[number];
function checkScripts(ctx: Context, declaration: BundleDeclaration) {
  return Effect.gen(function* () {
    for (const [name, command] of Object.entries(declaration.scripts ?? {})) {
      yield* validate(
        ctx,
        `scripts.${name}`,
        !name.startsWith("its-checks:") && /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(name),
        "Expected a script name outside the reserved its-checks: namespace",
      );
      yield* validate(
        ctx,
        `scripts.${name}`,
        !(typeof command === "string" ? command : command.command).includes("\0"),
        "Script must not contain NUL",
      );
    }
  });
}
function checkDependencies(ctx: Context, declaration: BundleDeclaration) {
  return Effect.gen(function* () {
    for (const section of ["dependencies", "devDependencies"] as const) {
      for (const [name, requirement] of Object.entries(declaration[section] ?? {})) {
        yield* validate(
          ctx,
          `${section}.${name}`,
          packageName.test(name),
          "Invalid npm package name",
        );
        yield* validate(
          ctx,
          `${section}.${name}`,
          // oxlint-disable-next-line no-control-regex -- Reject control characters in package requirements.
          !/[\x00-\x1f\x7f]/.test(requirement),
          "Dependency requirement must not contain control characters",
        );
      }
    }
    for (const name of Object.keys(declaration.dependencies ?? {})) {
      yield* validate(
        ctx,
        `devDependencies.${name}`,
        !Object.hasOwn(declaration.devDependencies ?? {}, name),
        "A package cannot be declared in both dependency sections of one bundle",
      );
    }
  });
}
function checkInput(ctx: Context, input: Input, index: number) {
  return Effect.gen(function* () {
    const field = `inputs[${index}]`;
    yield* validate(
      ctx,
      `${field}.id`,
      identifier.test(input.id),
      "Expected a lowercase hyphenated ID",
    );
    yield* checkPath(ctx, `${field}.destination.file`, input.destination.file);
    yield* validate(
      ctx,
      `${field}.destination.field`,
      input.destination.field.length > 0 &&
        input.destination.field.every(
          (key) =>
            typeof key !== "string" || !["__proto__", "prototype", "constructor"].includes(key),
        ),
      "Expected a nonempty field path without prototype keys",
    );
    if (input.default !== undefined) {
      yield* validate(
        ctx,
        `${field}.default`,
        typeof input.default === (input.type === "path" ? "string" : input.type),
        "Default must match the declared input type",
      );
      if (input.type === "path" && typeof input.default === "string") {
        yield* checkPath(ctx, `${field}.default`, input.default);
      }
    }
  });
}

/** Validate declaration semantics after decoding the structural schema. */
export function checkDeclaration(
  ctx: Context,
  declaration: BundleDeclaration,
): Effect.Effect<void, BundleError> {
  return Effect.gen(function* () {
    yield* checkScripts(ctx, declaration);
    yield* checkDependencies(ctx, declaration);
    yield* unique(ctx, "requires", declaration.requires ?? []);
    for (const id of declaration.requires ?? []) {
      yield* validate(
        ctx,
        "requires",
        identifier.test(id),
        "Dependencies must use source-local bundle IDs",
      );
    }
    for (const command of Object.values(declaration.scripts ?? {})) {
      if (typeof command !== "string") {
        yield* validate(
          ctx,
          "replaces",
          identifier.test(command.replaces),
          "Replacement targets must use source-local bundle IDs",
        );
      }
    }
    const files = declaration.files ?? [];
    yield* unique(
      ctx,
      "files.target",
      files.map((file) => file.target),
    );
    for (const file of files) {
      yield* checkFile(ctx, file);
    }
    const inputs = declaration.inputs ?? [];
    yield* unique(
      ctx,
      "inputs.id",
      inputs.map((input) => input.id),
    );
    for (const [index, input] of inputs.entries()) {
      yield* checkInput(ctx, input, index);
    }
  });
}
function checkFile(ctx: Context, file: FileDeclaration) {
  return Effect.gen(function* () {
    yield* checkPath(ctx, "files.source", file.source);
    yield* checkPath(ctx, "files.target", file.target);
    yield* validate(
      ctx,
      "files.source",
      file.source.startsWith("files/"),
      "File sources must be under files/",
    );
    yield* validate(
      ctx,
      "files.target",
      !["package.json", ".its-checks.json"].includes(file.target.toLowerCase()),
      "Package and saved-state files use dedicated contracts",
    );
    yield* validate(
      ctx,
      "files",
      file.operation === "compose"
        ? file.format !== undefined
        : file.fields === undefined && file.defaultMode === undefined,
      "Compose requires a JSON format; fields and defaultMode apply only to compose",
    );
    for (const [pointer, options] of Object.entries(file.fields ?? {})) {
      if (options.replaces !== undefined) {
        yield* validate(
          ctx,
          "files.fields.replaces",
          identifier.test(options.replaces),
          "Replacement targets must use source-local bundle IDs",
        );
      }
      yield* validate(
        ctx,
        "files.fields",
        pointer.startsWith("/") &&
          !/~(?![01])/u.test(pointer) &&
          !pointer
            .split("/")
            .some((key) =>
              ["__proto__", "constructor", "prototype"].includes(
                key.replaceAll("~1", "/").replaceAll("~0", "~"),
              ),
            ),
        "Expected a safe JSON Pointer",
      );
    }
  });
}
