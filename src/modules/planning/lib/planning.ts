import assert from "node:assert/strict";
import { TextDecoder } from "node:util";

import { Effect, Schema } from "effect";

import { canonical, compare, json, jsonContent } from "../../policy/documents.ts";
import type { JsonValue, ResolvedInputs } from "../../policy/index.ts";
import type {
  ChangeKind,
  ChangePlan,
  FileChange,
  FileState,
  PlanOptions,
  TargetSnapshot,
} from "../plan.ts";
import { collectFiles, composeTarget, orderedBundles, type Contribution } from "./composition.ts";
import { planManifest } from "./manifest-planning.ts";
import { PlanError } from "./plan-errors.ts";
import { readTargetSnapshot } from "./target-snapshot.ts";
const equal = (a: FileState, b: FileState) => JSON.stringify(a) === JSON.stringify(b);
function state(content: string, before: FileState, executable: boolean): FileState {
  let mode = before.kind === "file" ? before.mode : 0o644;
  if (executable) {
    mode = 0o755;
  }
  return { kind: "file", base64: Buffer.from(content).toString("base64"), mode };
}
function decode(source: string, file: FileState): Effect.Effect<JsonValue, PlanError> {
  return Effect.gen(function* () {
    if (file.kind === "absent") {
      return {};
    }
    const content = yield* Effect.try({
      try: () =>
        new TextDecoder("utf8", { fatal: true }).decode(Buffer.from(file.base64, "base64")),
      catch: (cause) => new PlanError({ source, field: "$", detail: String(cause) }),
    });
    return yield* json({ bundle: "target", source }, content, source !== "package.json").pipe(
      Effect.mapError(
        (cause) => new PlanError({ source, field: cause.field, detail: cause.detail }),
      ),
    );
  });
}
function kind(before: FileState, after: FileState): ChangeKind {
  if (equal(before, after)) {
    return "noop";
  }
  if (before.kind === "absent") {
    return "creation";
  }
  return after.kind === "absent" ? "removal" : "replacement";
}
function composeFile(
  relative: string,
  before: FileState,
  current?: Contribution,
  prior?: Contribution,
) {
  return Effect.gen(function* () {
    const original = yield* decode(relative, before);
    const output = yield* Effect.try({
      try: () => composeTarget(original, current?.file, prior?.file),
      catch: (cause) =>
        Schema.is(PlanError)(cause)
          ? cause
          : new PlanError({ source: relative, field: "$", detail: String(cause) }),
    });
    if (
      canonical(original) === canonical(output) &&
      !(before.kind === "absent" && current !== undefined)
    ) {
      return before;
    }
    return state(jsonContent(output), before, current?.file.executable ?? false);
  });
}
function contributionState(
  relative: string,
  before: FileState,
  current?: Contribution,
  prior?: Contribution,
): Effect.Effect<FileState, PlanError> {
  if (current?.file.operation === "seed") {
    return Effect.succeed(
      before.kind === "absent"
        ? state(current.file.content, before, current.file.executable)
        : before,
    );
  }
  if (current?.file.operation === "replace") {
    return Effect.succeed(state(current.file.content, before, current.file.executable));
  }
  if (current?.file.operation === "compose" || prior?.file.operation === "compose") {
    return composeFile(relative, before, current, prior);
  }
  return Effect.succeed(prior?.file.operation === "replace" ? { kind: "absent" } : before);
}
type Manifest = Effect.Success<ReturnType<typeof planManifest>>;
function planFiles(
  snapshot: TargetSnapshot,
  selected: ReadonlyMap<string, Contribution>,
  prior: ReadonlyMap<string, Contribution>,
  output: {
    readonly selection: ResolvedInputs["selectionFile"];
    readonly manifest: Manifest;
  },
) {
  return Effect.gen(function* () {
    const { selection, manifest } = output;
    const files: FileChange[] = [];
    for (const [relative, before] of Object.entries(snapshot.files)) {
      const current = selected.get(relative);
      const previous = prior.get(relative);
      let after: FileState;
      let reasons: readonly string[] = current?.owners ?? previous?.owners ?? [];
      if (relative === "package.json") {
        after = manifest.changed ? state(jsonContent(manifest.manifest), before, false) : before;
        reasons = ["targeted package contributions"];
      } else if (relative === selection.path) {
        after = state(selection.content, before, false);
        reasons = ["saved source revisions, explicit selections, and answers"];
      } else {
        after = yield* contributionState(relative, before, current, previous);
      }
      let changeKind = kind(before, after);
      const packageConflict =
        relative !== "package.json" || manifest.packageEntries.some((entry) => entry.conflict);
      if (relative === "package.json" && changeKind === "replacement" && !packageConflict) {
        changeKind = "addition";
      }
      files.push({
        path: relative,
        before,
        after,
        kind: changeKind,
        conflict: before.kind === "file" && changeKind !== "noop" && packageConflict,
        reasons,
      });
    }
    return files;
  });
}
/** Compose all sources against one complete target snapshot. Never writes or executes policy. */
export function planProject(
  projectRoot: string,
  resolved: ResolvedInputs,
  options: PlanOptions,
): Effect.Effect<ChangePlan, PlanError> {
  return Effect.gen(function* () {
    const selected = orderedBundles(resolved.policy.bundles);
    const previous = options.previousBundles ?? [];
    const currentFiles = yield* collectFiles(selected);
    const priorFiles = yield* collectFiles(previous);
    const paths = [
      ...new Set([
        "package.json",
        resolved.selectionFile.path,
        ...currentFiles.keys(),
        ...priorFiles.keys(),
      ]),
    ].toSorted();
    const snapshot = yield* readTargetSnapshot(projectRoot, paths);
    const packageFile = snapshot.files["package.json"];
    assert(packageFile !== undefined);
    if (packageFile.kind === "absent") {
      return yield* new PlanError({
        source: "package.json",
        field: "$",
        detail: "Required target file is missing",
      });
    }
    const manifest = yield* planManifest(
      yield* decode("package.json", packageFile),
      selected,
      previous,
      options,
    );
    const files = yield* planFiles(snapshot, currentFiles, priorFiles, {
      selection: resolved.selectionFile,
      manifest,
    });
    const sources = resolved.policy.sources
      .toSorted((a, b) => compare(a.repository, b.repository))
      .map(({ repository, commit }) => ({ repository, commit }));
    const bundles = selected.map((bundle) => ({
      key: bundle.key,
      explicit:
        resolved.policy.sources
          .find((source) => source.repository === bundle.repository)
          ?.bundles.includes(bundle.id) ?? false,
      requiredBy: selected
        .filter(
          (other) =>
            other.repository === bundle.repository &&
            other.declaration.requires?.includes(bundle.id) === true,
        )
        .map((other) => other.key),
    }));
    return {
      sources,
      bundles,
      snapshot,
      files,
      packageEntries: manifest.packageEntries,
      requiresConfirmation: files.some((file) => file.conflict),
      complete: true,
      deferred: [],
    };
  });
}
