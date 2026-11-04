import assert from "node:assert/strict";

import { Effect, Schema } from "effect";
import { applyEdits, modify, parse } from "jsonc-parser";

import { canonical, isArray, isObject } from "../documents.ts";
import { BundleError } from "./bundle-errors.ts";
import { safePath } from "./bundle-io.ts";
import type {
  BundleDeclaration,
  JsonValue,
  LoadedBundle,
  LoadedPolicy,
  NativeFile,
} from "./bundle-types.ts";
import {
  Answers,
  selectionContent,
  selectionFilename,
  selectionSchemaUrl,
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

function destination(bundle: LoadedBundle, input: InputDeclaration) {
  return Effect.gen(function* () {
    const field = `inputs.${input.id}.destination`;
    const file = bundle.files.find((candidate) => candidate.path === input.destination.file);
    if (file === undefined || (file.format !== "json" && file.format !== "jsonc")) {
      return yield* error(
        bundle,
        field,
        `Expected this bundle's JSON/JSONC file: ${input.destination.file}`,
      );
    }
    const keys = input.destination.field;
    yield* check(bundle, field, keys.length > 0, "Destination field must not be empty");
    let value: JsonValue | undefined = file.value;
    for (const key of keys) {
      yield* check(
        bundle,
        field,
        typeof key === "number"
          ? Number.isInteger(key) && key >= 0
          : !["__proto__", "prototype", "constructor"].includes(key),
        `Invalid destination key in ${file.source}`,
      );
      yield* check(
        bundle,
        field,
        value !== null &&
          typeof value === "object" &&
          (Array.isArray(value) ? typeof key === "number" : typeof key === "string") &&
          Object.hasOwn(value, key),
        `Destination field ${canonical(keys)} must exist with object keys/array indexes in ${file.source}`,
      );
      if (isArray(value) && typeof key === "number") {
        value = value[key];
      } else if (isObject(value) && typeof key === "string") {
        value = value[key];
      }
    }
    return file;
  });
}

function overlapping(a: InputDeclaration["destination"], b: InputDeclaration["destination"]) {
  return (
    a.file === b.file &&
    a.field.slice(0, Math.min(a.field.length, b.field.length)).every((key, i) => key === b.field[i])
  );
}

/** Enumerate only declarations, including baseline and automation; never infer questions. */
export function enumerateInputs(
  policy: LoadedPolicy,
  previous?: SavedIntent,
): Effect.Effect<readonly DeclaredInput[], BundleError> {
  return Effect.gen(function* () {
    const result: DeclaredInput[] = [];
    for (const bundle of policy.bundles) {
      const inputs = bundle.declaration.inputs ?? [];
      for (const [index, input] of inputs.entries()) {
        yield* destination(bundle, input);
        // Ancestor/descendant bindings are ambiguous even when the authored fields both exist.
        for (const other of inputs.slice(0, index)) {
          const overlaps = overlapping(input.destination, other.destination);
          yield* check(
            bundle,
            `inputs.${input.id}.destination`,
            !overlaps,
            `Overlapping input destinations: ${other.id} and ${input.id}`,
          );
        }
        const saved = answerAt(previous?.answers, bundle.key, input.id);
        const initialValue = saved ?? input.default;
        if (initialValue !== undefined) {
          yield* validateAnswer(
            bundle,
            input,
            initialValue,
            `${saved !== undefined ? "saved answers" : "defaults"}.${bundle.key}.${input.id}`,
          );
        }
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
  commit?: string,
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
    const selected = (kind: "integration" | "automation") =>
      policy.bundles.filter((bundle) => bundle.kind === kind).map((bundle) => bundle.id);
    const intent: SavedIntent = {
      $schema: yield* selectionSchemaUrl(policy.declaration.source),
      source: policy.declaration.source.repository,
      ...(commit === undefined ? {} : { commit }),
      integrations: selected("integration"),
      automation: selected("automation"),
      answers: intendedAnswers,
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
