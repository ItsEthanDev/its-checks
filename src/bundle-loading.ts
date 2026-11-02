import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TextDecoder } from "node:util";

import { Effect, Schema } from "effect";
import { parse, printParseErrorCode, visit, type ParseError } from "jsonc-parser";
import { parseAllDocuments } from "yaml";

import { BundleError } from "./bundle-errors.ts";
import {
  BundleDeclaration,
  RootDeclaration,
  type BundleInfo,
  type BundleKind,
  type JsonValue,
  type LoadedPolicy,
  type NativeFile,
  type PolicyCatalog,
  type PolicySelections,
} from "./bundle-types.ts";

type Context = { readonly bundle: string; readonly source: string };
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const fail = (ctx: Context, field: string, detail: string) =>
  new BundleError({ ...ctx, field, detail });
const io = <A>(ctx: Context, operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => fail(ctx, "$", cause instanceof Error ? cause.message : String(cause)),
  });
const validate = (ctx: Context, field: string, valid: boolean, detail: string) =>
  valid ? Effect.void : Effect.fail(fail(ctx, field, detail));

/** @internal Portable target-relative names, shared with saved intent; never interpret Windows paths on POSIX. */
export function safePath(value: string): boolean {
  return (
    value.length > 0 &&
    !/[\\:<>"|?*\x00-\x1f\x7f]/.test(value) &&
    value
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          part !== "." &&
          part !== ".." &&
          !/[. ]$/.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
          ![".git", "node_modules"].includes(part.toLowerCase()),
      )
  );
}

const checkPath = (ctx: Context, field: string, value: string) =>
  validate(
    ctx,
    field,
    safePath(value),
    `Expected a safe target-relative POSIX path, got ${JSON.stringify(value)}`,
  );

/** @internal Strict local UTF-8 read; never follows the final symbolic link. */
export function readText(ctx: Context) {
  return Effect.gen(function* () {
    const stat = yield* io(ctx, () => fs.lstat(ctx.source));
    yield* validate(
      ctx,
      "$",
      stat.isFile(),
      "Expected a regular file; symbolic links are not supported",
    );
    return yield* Effect.acquireUseRelease(
      io(ctx, () => fs.open(ctx.source, constants.O_RDONLY | constants.O_NOFOLLOW)),
      (handle) =>
        io(ctx, async () =>
          new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile()),
        ),
      (handle) => io(ctx, () => handle.close()),
    );
  });
}

/** @internal Strict JSON/JSONC parsing shared with saved intent. */
export function json(ctx: Context, content: string, comments: boolean) {
  return Effect.try({
    try: () => {
      const errors: ParseError[] = [];
      const options = {
        disallowComments: !comments,
        allowTrailingComma: comments,
        allowEmptyContent: false,
      };
      // Both JSON and JSONC normally accept duplicate keys. Policy cannot silently lose declarations.
      const objects: Set<string>[] = [];
      let invalid: string | undefined;
      visit(
        content,
        {
          onObjectBegin: () => {
            objects.push(new Set());
          },
          onObjectProperty: (name, offset) => {
            const keys = objects.at(-1)!;
            if (keys.has(name))
              {invalid = `Duplicate object key ${JSON.stringify(name)} at offset ${offset}`;}
            // jsonc-parser assigns to ordinary objects; this key would alter their prototypes.
            if (name === "__proto__") {invalid = `Unsupported prototype key at offset ${offset}`;}
            keys.add(name);
          },
          onLiteralValue: (value, offset) => {
            if (typeof value === "number" && !Number.isFinite(value))
              {invalid = `Nonfinite JSON number at offset ${offset}`;}
          },
          onObjectEnd: () => {
            objects.pop();
          },
        },
        options,
      );
      if (invalid) {throw new Error(invalid);}
      const value: unknown = parse(content, errors, options);
      if (errors.length)
        {throw new Error(
          errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join("; "),
        );}
      return value as JsonValue;
    },
    catch: (cause) => fail(ctx, "$", cause instanceof Error ? cause.message : String(cause)),
  });
}

function decode<S extends Schema.Constraint & { readonly DecodingServices: never }>(
  ctx: Context,
  schema: S,
  value: unknown,
) {
  return Schema.decodeUnknownEffect(schema, { onExcessProperty: "error", errors: "all" })(
    value,
  ).pipe(Effect.mapError((cause) => fail(ctx, "$", cause.message)));
}

function directory(ctx: Context, optional = false) {
  return Effect.gen(function* () {
    const stat = yield* Effect.tryPromise({
      try: () => fs.lstat(ctx.source),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        optional && (cause as NodeJS.ErrnoException).code === "ENOENT"
          ? Effect.succeed(undefined)
          : Effect.fail(fail(ctx, "$", cause instanceof Error ? cause.message : String(cause))),
      ),
    );
    if (!stat) {return [];}
    yield* validate(
      ctx,
      "$",
      stat.isDirectory(),
      "Expected a directory; symbolic links are not supported",
    );
    return (yield* io(ctx, () => fs.readdir(ctx.source))).sort(compare);
  });
}

function unique(ctx: Context, field: string, values: readonly string[]) {
  return validate(
    ctx,
    field,
    new Set(values.map((s) => s.toLowerCase())).size === values.length,
    "Duplicate identity or path (including case-insensitive aliases)",
  );
}

function checkDeclaration(ctx: Context, declaration: BundleDeclaration) {
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
    for (const section of ["dependencies", "devDependencies"] as const) {
      for (const name of Object.keys(declaration[section] ?? {})) {
        yield* validate(
          ctx,
          `${section}.${name}`,
          packageName.test(name),
          "Invalid npm package name",
        );
        yield* validate(
          ctx,
          `${section}.${name}`,
          !/[\x00-\x1f\x7f]/.test(declaration[section]![name]!),
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
    const migration = declaration.migration;
    if (migration) {
      for (const section of [
        "removeFiles",
        "removeDependencies",
        "removeDevDependencies",
      ] as const) {
        const values = migration[section] ?? [];
        yield* unique(ctx, `migration.${section}`, values);
        for (const value of values) {
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
        }
      }
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
        if (input.type === "path" && typeof input.default === "string")
          {yield* checkPath(ctx, `${field}.default`, input.default);}
      }
    }
  });
}

function bundle(root: string, kind: BundleKind, id: string) {
  const key =
    kind === "base" ? "base" : `${kind === "integration" ? "integrations" : "automation"}/${id}`;
  const dir = path.join(root, "typescript", key);
  const ctx = { bundle: key, source: path.join(dir, "bundle.json") };
  return Effect.gen(function* () {
    const entries = yield* directory({ ...ctx, source: dir });
    yield* validate(
      ctx,
      "$",
      entries.every((entry) => entry === "bundle.json" || entry === "files"),
      "Bundle directories contain only bundle.json and files/; executable installers are not supported",
    );
    const declaration = yield* decode(
      ctx,
      BundleDeclaration,
      yield* json(ctx, yield* readText(ctx), false),
    );
    yield* checkDeclaration(ctx, declaration);
    return { id, key, kind, directory: dir, source: ctx.source, declaration } satisfies BundleInfo;
  });
}

/** Discover display metadata without loading unselected native policy. No target filesystem is accepted. */
export function discoverPolicy(policyRoot: string): Effect.Effect<PolicyCatalog, BundleError> {
  return Effect.gen(function* () {
    const root = path.resolve(policyRoot);
    const ctx = { bundle: "policy", source: path.join(root, "bundle.json") };
    yield* directory({ ...ctx, source: root });
    yield* directory({ ...ctx, source: path.join(root, "typescript") });
    const declaration = yield* decode(
      ctx,
      RootDeclaration,
      yield* json(ctx, yield* readText(ctx), false),
    );
    let url: URL | undefined;
    try {
      url = new URL(declaration.source.repository);
    } catch {
      /* Report through typed failure below. */
    }
    yield* validate(
      ctx,
      "source.repository",
      !!url &&
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash,
      "Expected an HTTPS repository URL without credentials, query, or fragment",
    );
    yield* checkPath(ctx, "source.selectionSchema", declaration.source.selectionSchema);
    yield* validate(
      ctx,
      "source.selectionSchema",
      declaration.source.selectionSchema.endsWith(".json"),
      "Expected a repository-relative JSON Schema path",
    );
    const baseline = yield* bundle(root, "base", "base");
    const discover = (kind: "integration" | "automation") =>
      Effect.gen(function* () {
        const parent = path.join(
          root,
          "typescript",
          kind === "integration" ? "integrations" : "automation",
        );
        const ids = yield* directory({ bundle: "policy", source: parent }, true);
        yield* unique({ bundle: "policy", source: parent }, "$", ids);
        const bundles: BundleInfo[] = [];
        for (const id of ids) {
          yield* validate(
            { bundle: id, source: parent },
            "$",
            identifier.test(id),
            "Bundle directory IDs must be lowercase words separated by hyphens",
          );
          bundles.push(yield* bundle(root, kind, id));
        }
        return bundles;
      });
    return {
      root,
      declaration,
      baseline,
      integrations: yield* discover("integration"),
      automation: yield* discover("automation"),
    };
  });
}

function nativeFiles(info: BundleInfo) {
  return Effect.gen(function* () {
    const files: NativeFile[] = [];
    const root = path.join(info.directory, "files");
    const walk = (relative: string): Effect.Effect<void, BundleError> =>
      Effect.gen(function* () {
        const source = path.join(root, relative);
        const ctx = { bundle: info.key, source };
        for (const name of yield* directory(ctx, relative === "")) {
          const target = relative ? `${relative}/${name}` : name;
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
          const common = {
            path: target,
            source: child.source,
            content,
            executable: (stat.mode & 0o111) !== 0,
          };
          const extension = path.posix.extname(target).toLowerCase();
          if (extension === ".json" || extension === ".jsonc") {
            const value = yield* json(child, content, extension === ".jsonc");
            yield* validate(
              child,
              "$",
              value !== null && typeof value === "object" && !Array.isArray(value),
              "Native JSON configuration must be an object",
            );
            files.push({ ...common, format: extension === ".json" ? "json" : "jsonc", value });
          } else if (extension === ".yaml" || extension === ".yml") {
            yield* Effect.try({
              try: () => {
                const documents = parseAllDocuments(content, { uniqueKeys: true });
                const errors = documents.flatMap((doc) => doc.errors);
                if (errors.length) {throw new Error(errors.map((error) => error.message).join("; "));}
                if (documents.length !== 1) {throw new Error("Expected one YAML document");}
              },
              catch: (cause) => fail(child, "$", String(cause)),
            });
            files.push({ ...common, format: "yaml" });
          } else {
            yield* validate(
              child,
              "$",
              extension === ".sh" || (extension === "" && target.startsWith(".husky/")),
              "Supported native formats: JSON, JSONC, YAML, .sh, and extensionless .husky hooks; executable installers are not supported",
            );
            yield* validate(child, "$", !content.includes("\0"), "Shell files cannot contain NUL");
            files.push({ ...common, format: "shell" });
          }
        }
      });
    yield* walk("");
    files.sort((a, b) => compare(a.path, b.path));
    yield* unique(
      { bundle: info.key, source: root },
      "$",
      files.map((file) => file.path),
    );
    for (const [index, input] of (info.declaration.inputs ?? []).entries()) {
      const ctx = { bundle: info.key, source: info.source };
      const file = files.find((file) => file.path === input.destination.file);
      yield* validate(
        ctx,
        `inputs[${index}].destination.file`,
        !!file && (file.format === "json" || file.format === "jsonc"),
        "Input destination must name this bundle's native JSON/JSONC file",
      );
      if (file && (file.format === "json" || file.format === "jsonc")) {
        let value: JsonValue | undefined = file.value;
        for (const key of input.destination.field) {
          value =
            value !== null && typeof value === "object" && Object.hasOwn(value, key)
              ? (value as Record<string | number, JsonValue>)[key]
              : undefined;
        }
        yield* validate(
          ctx,
          `inputs[${index}].destination.field`,
          value !== undefined,
          `Destination field must exist in ${file.source}`,
        );
      }
    }
    return { ...info, files };
  });
}

/** Load baseline and explicit selections. Read-only: never executes policy, installs, or writes. */
export function loadPolicy(
  policyRoot: string,
  selections: PolicySelections,
): Effect.Effect<LoadedPolicy, BundleError> {
  return Effect.gen(function* () {
    const catalog = yield* discoverPolicy(policyRoot);
    const selected: BundleInfo[] = [catalog.baseline];
    for (const kind of ["integrations", "automation"] as const) {
      const ctx = { bundle: "policy", source: catalog.root };
      yield* unique(ctx, `selections.${kind}`, selections[kind]);
      for (const id of [...selections[kind]].sort(compare)) {
        const info = catalog[kind].find((bundle) => bundle.id === id);
        if (!info)
          {return yield* Effect.fail(
            fail(ctx, `selections.${kind}`, `Unknown bundle ID ${JSON.stringify(id)}`),
          );}
        selected.push(info);
      }
    }
    const bundles = [];
    for (const info of selected) {bundles.push(yield* nativeFiles(info));}
    return { root: catalog.root, declaration: catalog.declaration, bundles };
  });
}
