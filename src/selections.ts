import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect, Schema } from "effect";
import { BundleError } from "./bundle-errors.ts";
import { json, readText, safePath } from "./bundle-loading.ts";
import type { RootDeclaration } from "./bundle-types.ts";

export const selectionFilename = ".its-checks.json";
const id = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const namespace = /^(?:base|(?:integrations|automation)\/[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const Id = Schema.String.check(Schema.makeFilter((value) => id.test(value) || "Expected a lowercase hyphenated ID"));
const Namespace = Schema.String.check(Schema.makeFilter((value) => namespace.test(value) || "Expected a namespaced bundle key"));
export const Answer = Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite()), Schema.Boolean]);
export const Answers = Schema.Record(Namespace, Schema.Record(Id, Answer));
export type Answer = typeof Answer.Type;
export type Answers = typeof Answers.Type;

const SelectionFile = Schema.Struct({
  $schema: Schema.String,
  schemaVersion: Schema.Literal(1),
  source: Schema.Struct({ repository: Schema.String, revision: Schema.String, selectionSchema: Schema.String }),
  integrations: Schema.Array(Id),
  automation: Schema.Array(Id),
  answers: Answers,
});
export type SavedIntent = typeof SelectionFile.Type;

const context = (source: string, field: string, detail: string) => new BundleError({ bundle: "selections", source, field, detail });
const check = (source: string, field: string, valid: boolean, detail: string) => valid
  ? Effect.void : Effect.fail(context(source, field, detail));

/** GitHub-compatible revision-pinned raw URL; metadata availability is not probed. */
export function selectionSchemaUrl(source: RootDeclaration["source"]): Effect.Effect<string, BundleError> {
  return Effect.gen(function*() {
    let repository: URL | undefined;
    try { repository = new URL(source.repository); } catch { /* Typed failure below. */ }
    yield* check("provenance", "source.repository", !!repository && repository.protocol === "https:" &&
      !repository.username && !repository.password && !repository.search && !repository.hash,
    "Expected an HTTPS repository URL without credentials, query, or fragment");
    yield* check("provenance", "source.revision", /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source.revision),
      "Expected a full immutable Git revision (40 or 64 lowercase hex digits)");
    yield* check("provenance", "source.selectionSchema", safePath(source.selectionSchema) && source.selectionSchema.endsWith(".json"),
      "Expected a safe repository-relative JSON Schema path");
    return `${source.repository.replace(/\/$/, "")}/raw/${source.revision}/${source.selectionSchema.split("/").map(encodeURIComponent).join("/")}`;
  });
}

/** Decode local intent without contacting its repository or schema. */
export function decodeSavedIntent(content: string, source = selectionFilename): Effect.Effect<SavedIntent, BundleError> {
  return Effect.gen(function*() {
    const value = yield* json({ bundle: "selections", source }, content, false);
    const saved = yield* Schema.decodeUnknownEffect(SelectionFile, { onExcessProperty: "error", errors: "all" })(value).pipe(
      Effect.mapError((error) => context(source, "$", error.message)),
    );
    for (const kind of ["integrations", "automation"] as const) {
      yield* check(source, kind, new Set(saved[kind]).size === saved[kind].length, "Duplicate selection ID");
    }
    const expected = yield* selectionSchemaUrl(saved.source).pipe(
      Effect.mapError((error) => context(source, error.field, error.detail)),
    );
    yield* check(source, "$schema", saved.$schema === expected, "Schema URL must match source repository, revision, and selectionSchema");
    return saved;
  });
}

/** Absence means first use; all other filesystem/decoding failures are reported. No writes. */
export function loadPreviousIntent(projectRoot: string): Effect.Effect<SavedIntent | undefined, BundleError> {
  return Effect.gen(function*() {
    const source = path.resolve(projectRoot, selectionFilename);
    const exists = yield* Effect.tryPromise({
      try: () => fs.lstat(source),
      catch: (cause) => cause,
    }).pipe(Effect.catch((cause) => (cause as NodeJS.ErrnoException).code === "ENOENT"
      ? Effect.succeed(undefined)
      : Effect.fail(context(source, "$", cause instanceof Error ? cause.message : String(cause)))));
    if (!exists) return undefined;
    return yield* decodeSavedIntent(yield* readText({ bundle: "selections", source }), source);
  });
}

/** Validate even typed callers and serialize intended state, not installation success. */
export function selectionContent(intent: SavedIntent): Effect.Effect<string, BundleError> {
  return Effect.gen(function*() {
    const content = yield* Effect.try({
      try: () => JSON.stringify(intent, null, 2) + "\n",
      catch: (cause) => context(selectionFilename, "$", String(cause)),
    });
    yield* decodeSavedIntent(content);
    return content;
  });
}
