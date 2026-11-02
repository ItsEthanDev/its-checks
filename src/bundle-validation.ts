import { Effect } from "effect";

import type { BundleError } from "./bundle-errors.ts";
import { checkPath, unique, validate, type Context } from "./bundle-io.ts";
import type { BundleDeclaration } from "./bundle-types.ts";

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
function checkMigration(ctx: Context, migration: NonNullable<BundleDeclaration["migration"]>) {
  return Effect.gen(function* () {
    for (const section of ["removeFiles", "removeDependencies", "removeDevDependencies"] as const) {
      const values = migration[section] ?? [];
      yield* unique(ctx, `migration.${section}`, values);
      for (const value of values) {
        yield* checkMigrationEntry(ctx, section, value);
      }
    }
  });
}
function checkMigrationEntry(ctx: Context, section: string, value: string) {
  return Effect.gen(function* () {
    if (section === "removeFiles") {
      yield* checkPath(ctx, `migration.${section}`, value);
      yield* validate(
        ctx,
        `migration.${section}`,
        !value.split("/").some((p) => p.toLowerCase() === "package.json"),
        "Cannot remove a package manifest",
      );
    } else {
      yield* validate(
        ctx,
        `migration.${section}`,
        packageName.test(value),
        "Invalid npm package name",
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
      `${field}.destination.file`,
      /\.jsonc?$/i.test(input.destination.file),
      "Input destinations must be JSON/JSONC files",
    );
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
    if (declaration.migration !== undefined) {
      yield* checkMigration(ctx, declaration.migration);
    }
    const inputs = declaration.inputs ?? [];
    yield* unique(
      ctx,
      "inputs.id",
      inputs.map((input) => input.id),
    );
    const destinations = inputs.map((input) =>
      JSON.stringify([input.destination.file, input.destination.field]),
    );
    yield* validate(
      ctx,
      "inputs.destination",
      new Set(destinations).size === destinations.length,
      "Duplicate input destination",
    );
    for (const [index, input] of inputs.entries()) {
      yield* checkInput(ctx, input, index);
    }
  });
}
