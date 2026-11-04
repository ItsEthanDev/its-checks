import assert from "node:assert/strict";

import { Effect, Schema } from "effect";
import { applyEdits, modify, parse } from "jsonc-parser";

import { BundleError } from "./bundle-errors.ts";
import { safePath, compare } from "./bundle-io.ts";
import type { BundleDeclaration, LoadedBundle, LoadedPolicy, NativeFile } from "./bundle-types.ts";
import {
  Answers,
  selectionContent,
  selectionFilename,
  qualifiedAnswers,
  type Answer,
  type SavedIntent,
} from "./selections.ts";

type InputDeclaration = NonNullable<BundleDeclaration["inputs"]>[number];
export interface DeclaredInput {
  readonly bundle: string;
  readonly source: string;
  readonly input: InputDeclaration;
  /** Presentation-only suggestion. resolveInputs never accepts this implicitly. */
  readonly initialValue?: Answer;
}
export interface ResolvedInputs {
  /** Bound native fragments, ready for composition; original policy is untouched. */
  readonly policy: LoadedPolicy;
  readonly intent: SavedIntent;
  readonly selectionFile: { readonly path: string; readonly content: string };
}
const answerAt = (answers: Answers | undefined, bundle: string, id: string): Answer | undefined => {
  const values = answers?.[bundle];
  return values !== undefined && Object.hasOwn(values, id) ? values[id] : undefined;
};
const error = (bundle: LoadedBundle, field: string, detail: string) =>
  new BundleError({
    bundle: bundle.key,
    source: bundle.source,
    field,
    detail,
  });
const check = (bundle: LoadedBundle, field: string, valid: boolean, detail: string) =>
  valid ? Effect.void : Effect.fail(error(bundle, field, detail));

function validateAnswer(
  bundle: LoadedBundle,
  input: InputDeclaration,
  value: Answer,
  field: string,
) {
  return Effect.gen(function* () {
    yield* check(
      bundle,
      field,
      typeof value === (input.type === "path" ? "string" : input.type) &&
        (typeof value !== "number" || Number.isFinite(value)),
      `Input ${input.id} requires ${input.type}`,
    );
    if (input.type === "path") {
      yield* check(
        bundle,
        field,
        typeof value === "string" && safePath(value),
        `Input ${input.id} requires a safe target-package-relative POSIX path; existence is not required`,
      );
    }
  });
}

/** Enumerate selected bundles and dependencies; defaults and saved values are suggestions only. */
export function enumerateInputs(
  policy: LoadedPolicy,
  previous?: SavedIntent,
): Effect.Effect<readonly DeclaredInput[], BundleError> {
  return Effect.gen(function* () {
    const result: DeclaredInput[] = [];
    for (const bundle of policy.bundles) {
      const inputs = bundle.declaration.inputs ?? [];
      for (const input of inputs) {
        const saved = answerAt(
          previous === undefined ? undefined : qualifiedAnswers(previous.sources),
          bundle.key,
          input.id,
        );
        const validSaved =
          saved === undefined
            ? false
            : yield* validateAnswer(bundle, input, saved, "saved answers").pipe(
                Effect.match({ onSuccess: () => true, onFailure: () => false }),
              );
        const initialValue = validSaved ? saved : input.default;
        result.push({
          bundle: bundle.key,
          source: bundle.source,
          input,
          ...(initialValue === undefined ? {} : { initialValue }),
        });
      }
    }
    return result;
  });
}

function bind(file: NativeFile, input: InputDeclaration, answer: Answer): NativeFile {
  if (file.format !== "json" && file.format !== "jsonc") {
    return file;
  }
  const keys = input.destination.field;
  const content = applyEdits(
    file.content,
    modify(file.content, [...keys], answer, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
  const parsed: unknown = parse(content);
  const value = Schema.decodeUnknownSync(Schema.Json)(parsed);
  return { ...file, value, content };
}

/** Require explicit typed answers for exactly the selected declarations; return content without writing. */
export function resolveInputs(
  policy: LoadedPolicy,
  supplied: unknown,
): Effect.Effect<ResolvedInputs, BundleError> {
  return Effect.gen(function* () {
    const ctx = { bundle: "inputs", source: policy.root, field: "answers" };
    const answers = yield* Schema.decodeUnknownEffect(Answers, {
      onExcessProperty: "error",
      errors: "all",
    })(supplied).pipe(
      Effect.mapError((cause) => new BundleError({ ...ctx, detail: cause.message })),
    );
    const declared = yield* enumerateInputs(policy);
    yield* validateSuppliedAnswers(policy, answers, declared);
    const bundles = yield* Effect.forEach(policy.bundles, (bundle) => bindBundle(bundle, answers));
    // Rebuild the answer map from declarations: no empty namespaces or stale input history.
    const intendedAnswers: Record<string, Record<string, Answer>> = {};
    for (const { bundle, input } of declared) {
      const answer = answerAt(answers, bundle, input.id);
      assert(answer !== undefined);
      (intendedAnswers[bundle] ??= {})[input.id] = answer;
    }
    const intent: SavedIntent = {
      schemaVersion: 2,
      sources: policy.sources
        .toSorted((a, b) => compare(a.repository, b.repository))
        .map((source) => ({
          repository: source.repository,
          commit: source.commit,
          bundles: source.bundles,
          answers: Object.fromEntries(
            Object.entries(intendedAnswers)
              .filter(([key]) => key.startsWith(`${source.repository}:`))
              .map(([key, values]) => [key.slice(source.repository.length + 1), values]),
          ),
        })),
    };
    return {
      policy: { ...policy, bundles },
      intent,
      selectionFile: { path: selectionFilename, content: yield* selectionContent(intent) },
    };
  });
}

function validateSuppliedAnswers(
  policy: LoadedPolicy,
  answers: Answers,
  declared: readonly DeclaredInput[],
) {
  return Effect.gen(function* () {
    const ctx = { bundle: "inputs", source: policy.root, field: "answers" };
    for (const [key, values] of Object.entries(answers)) {
      for (const id of Object.keys(values)) {
        if (!declared.some((entry) => entry.bundle === key && entry.input.id === id)) {
          return yield* new BundleError({
            ...ctx,
            field: `answers.${key}.${id}`,
            detail:
              "Answer is not declared by a selected bundle; discard deselected/retired answers before resolving",
          });
        }
      }
      if (!policy.bundles.some((bundle) => bundle.key === key)) {
        return yield* new BundleError({
          ...ctx,
          field: `answers.${key}`,
          detail: "Answer namespace is not selected",
        });
      }
    }
    for (const entry of declared) {
      const bundle = policy.bundles.find((candidate) => candidate.key === entry.bundle);
      assert(bundle !== undefined);
      const value = answerAt(answers, entry.bundle, entry.input.id);
      if (value === undefined) {
        return yield* error(
          bundle,
          `answers.${entry.bundle}.${entry.input.id}`,
          "Missing explicit answer; supply this input even when a saved value/default exists",
        );
      }
      yield* validateAnswer(
        bundle,
        entry.input,
        value,
        `answers.${entry.bundle}.${entry.input.id}`,
      );
    }
    return undefined;
  });
}

function bindBundle(bundle: LoadedBundle, answers: Answers) {
  return Effect.try({
    try: () => ({
      ...bundle,
      files: bundle.files.map((file) => {
        let bound = file;
        for (const input of bundle.declaration.inputs ?? []) {
          if (input.destination.file === file.path) {
            const answer = answerAt(answers, bundle.key, input.id);
            assert(answer !== undefined);
            bound = bind(bound, input, answer);
          }
        }
        return bound;
      }),
    }),
    catch: (cause) =>
      error(bundle, "inputs.destination", cause instanceof Error ? cause.message : String(cause)),
  });
}
