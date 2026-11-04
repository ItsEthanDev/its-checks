import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect, Schema } from "effect";

import { BundleError } from "./bundle-errors.ts";
import { decode, json, readText, unique, validate } from "./bundle-io.ts";

export const selectionFilename = ".its-checks.json";
export const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const Id = Schema.String.check(
  Schema.makeFilter(
    (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || "Expected a lowercase hyphenated ID",
  ),
);
export const Answer = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);
/** Resolved input answers use source-qualified keys; persisted answers are source-local. */
export const Answers = Schema.Record(Schema.String, Schema.Record(Id, Answer));
export type Answer = typeof Answer.Type;
export type Answers = typeof Answers.Type;
export const SourceConfig = Schema.Struct({
  repository: Schema.String,
  commit: Schema.String.check(
    Schema.makeFilter((value) => commitPattern.test(value) || "Expected an exact policy commit"),
  ),
  bundles: Schema.Array(Id),
  answers: Schema.Record(Id, Schema.Record(Id, Answer)),
});
export type SourceConfig = typeof SourceConfig.Type;
export const State = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  sources: Schema.Array(SourceConfig),
});
export type SavedIntent = typeof State.Type;

export function validateSources(
  sources: readonly SourceConfig[],
): Effect.Effect<void, BundleError> {
  const ctx = { bundle: "selections", source: selectionFilename };
  return Effect.gen(function* () {
    yield* unique(
      ctx,
      "sources",
      sources.map((source) => source.repository),
    );
    for (const source of sources) {
      yield* validate(
        ctx,
        "repository",
        /^[a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+$/.test(source.repository) &&
          ![".", ".."].includes(source.repository.split("/")[1] ?? ""),
        "Expected a canonical lowercase GitHub owner/repo",
      );
      yield* unique(ctx, "bundles", source.bundles);
    }
  });
}
export function decodeSavedIntent(
  content: string,
  source = selectionFilename,
): Effect.Effect<SavedIntent, BundleError> {
  return Effect.gen(function* () {
    const ctx = { bundle: "selections", source };
    const state = yield* decode(ctx, State, yield* json(ctx, content, false));
    yield* validateSources(state.sources);
    return state;
  });
}
export function loadPreviousIntent(
  projectRoot: string,
): Effect.Effect<SavedIntent | undefined, BundleError> {
  return Effect.gen(function* () {
    const source = path.resolve(projectRoot, selectionFilename);
    const exists = yield* Effect.tryPromise({
      try: async () => {
        try {
          await fs.lstat(source);
          return true;
        } catch (cause) {
          if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
            return false;
          }
          throw cause;
        }
      },
      catch: (cause) =>
        new BundleError({ bundle: "selections", source, field: "$", detail: String(cause) }),
    });
    return exists
      ? yield* decodeSavedIntent(yield* readText({ bundle: "selections", source }), source)
      : undefined;
  });
}
export function selectionContent(intent: SavedIntent): Effect.Effect<string, BundleError> {
  return Effect.gen(function* () {
    const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(State, { space: 2 }))(
      intent,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new BundleError({
            bundle: "selections",
            source: selectionFilename,
            field: "$",
            detail: cause.message,
          }),
      ),
    );
    const content = `${encoded}\n`;
    yield* decodeSavedIntent(content);
    return content;
  });
}
export function qualifiedAnswers(sources: readonly SourceConfig[]): Answers {
  return Object.fromEntries(
    sources.flatMap((source) =>
      Object.entries(source.answers).map(([id, answers]) => [
        `${source.repository}:${id}`,
        answers,
      ]),
    ),
  );
}
