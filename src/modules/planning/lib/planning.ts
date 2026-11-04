import assert from "node:assert/strict";
import { TextDecoder } from "node:util";

import { Effect } from "effect";

import { canonical, json, jsonContent } from "../../policy/documents.ts";
import type { JsonValue, LoadedBundle, ResolvedInputs } from "../../policy/index.ts";
import type {
  ChangeKind,
  ChangePlan,
  FileChange,
  FileState,
  PlanOptions,
  TargetSnapshot,
} from "../plan.ts";
import { isAutomationPath, prepareAutomation, type AutomationChange } from "./automation.ts";
import { composeConfigurations, configDestination, orderedBundles } from "./composition.ts";
import { planManifest } from "./manifest-planning.ts";
import { PlanError } from "./plan-errors.ts";
import { readTargetSnapshot } from "./target-snapshot.ts";
// Explicit competing names, not a search heuristic or a released-version discovery claim.
const alternates = ["oxfmt", "oxlint"].flatMap((tool) =>
  [`.${tool}rc.jsonc`].concat(
    ["ts", "mts", "cts", "js", "mjs", "cjs"].map((extension) => `${tool}.config.${extension}`),
  ),
);
type DesiredFile = { content: string; executable: boolean; reasons: string[]; json?: JsonValue };
const state = (content: string, before: FileState, executable = false): FileState => {
  let mode = executable ? 0o755 : 0o644;
  if (before.kind === "file") {
    mode = before.mode;
  }
  return { kind: "file", base64: Buffer.from(content).toString("base64"), mode };
};
const equal = (a: FileState, b: FileState) => JSON.stringify(a) === JSON.stringify(b);
const fail = (source: string, field: string, detail: string) =>
  new PlanError({ source, field, detail });
function decode(source: string, file: FileState): Effect.Effect<JsonValue, PlanError> {
  return Effect.gen(function* () {
    if (file.kind === "absent") {
      return yield* fail(source, "$", "Required target file is missing");
    }
    const text = yield* Effect.try({
      try: () =>
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(file.base64, "base64")),
      catch: (cause) => fail(source, "$", String(cause)),
    });
    return yield* json({ bundle: "target", source }, text, source !== "package.json").pipe(
      Effect.mapError((cause) => fail(source, cause.field, cause.detail)),
    );
  });
}
function deselectedBundles(selected: readonly LoadedBundle[], options: PlanOptions) {
  const selectedKeys = new Set(selected.map((bundle) => bundle.key));
  const previousKeys = new Set([
    ...(options.previous?.integrations.map((id) => `integrations/${id}`) ?? []),
    ...(options.previous?.automation.map((id) => `automation/${id}`) ?? []),
  ]);
  return orderedBundles(options.currentBundles ?? []).filter(
    (bundle) => previousKeys.has(bundle.key) && !selectedKeys.has(bundle.key),
  );
}
function dedicatedFiles(selected: readonly LoadedBundle[], desired: Map<string, DesiredFile>) {
  return Effect.gen(function* () {
    for (const bundle of selected) {
      for (const file of bundle.files) {
        if (configDestination(file.path) !== undefined || isAutomationPath(file.path)) {
          continue;
        }
        if (file.path === ".its-checks.json") {
          return yield* fail(file.source, "$", "The saved-intent destination is reserved");
        }
        const existing = desired.get(file.path);
        if (
          existing !== undefined &&
          (existing.content !== file.content || existing.executable !== file.executable)
        ) {
          return yield* fail(
            file.source,
            "$",
            `Different dedicated-file contributions at ${file.path}: ${existing.reasons.join(", ")} and ${bundle.key}`,
          );
        }
        desired.set(file.path, {
          content: file.content,
          executable: file.executable,
          reasons: [...(existing?.reasons ?? []), bundle.key],
        });
      }
    }
    return undefined;
  });
}
function fileRemovals(
  selected: readonly LoadedBundle[],
  deselected: readonly LoadedBundle[],
  desired: ReadonlyMap<string, DesiredFile>,
) {
  return Effect.gen(function* () {
    const removals = new Map<string, string[]>();
    const remove = (relative: string, reason: string) => {
      if (!isAutomationPath(relative)) {
        removals.set(relative, [...(removals.get(relative) ?? []), reason]);
      }
    };
    for (const relative of alternates) {
      remove(relative, "explicit competing Oxc configuration name");
    }
    for (const bundle of selected) {
      for (const relative of bundle.declaration.migration?.removeFiles ?? []) {
        if (desired.has(relative)) {
          return yield* fail(
            bundle.source,
            "migration.removeFiles",
            `Cannot remove selected output ${relative}`,
          );
        }
        remove(relative, `${bundle.key}: explicit migration`);
      }
    }
    for (const bundle of deselected) {
      for (const file of bundle.files) {
        if (configDestination(file.path) === undefined && !desired.has(file.path)) {
          remove(file.path, `${bundle.key}: current-known deselection`);
        }
      }
    }
    // A selected fragment may not reintroduce an alternate executable config alongside generated JSON.
    for (const relative of removals.keys()) {
      if (desired.has(relative)) {
        return yield* fail(relative, "$", "Selected output conflicts with a declared removal");
      }
    }
    return removals;
  });
}
type FilePlanning = {
  snapshot: TargetSnapshot;
  desired: ReadonlyMap<string, DesiredFile>;
  removals: ReadonlyMap<string, string[]>;
  automation: ReadonlyMap<string, AutomationChange>;
  manifestChanged: boolean;
  packageConflict: boolean;
};
function plannedState(relative: string, before: FileState, context: FilePlanning) {
  return Effect.gen(function* () {
    const output = context.desired.get(relative);
    const after =
      context.automation.get(relative)?.after ??
      (output !== undefined
        ? state(output.content, before, output.executable)
        : { kind: "absent" as const });
    if (relative === "package.json" && !context.manifestChanged) {
      return before;
    }
    if (output?.json !== undefined && before.kind === "file") {
      const parsed = yield* decode(relative, before).pipe(Effect.orElseSucceed(() => undefined));
      if (parsed !== undefined && canonical(parsed) === canonical(output.json)) {
        return before;
      }
    }
    return after;
  });
}
function fileKind(before: FileState, after: FileState, packageAddition: boolean): ChangeKind {
  if (equal(before, after)) {
    return "noop";
  }
  if (before.kind === "absent") {
    return "creation";
  }
  if (after.kind === "absent") {
    return "removal";
  }
  return packageAddition ? "addition" : "replacement";
}
function fileChanges(context: FilePlanning) {
  return Effect.gen(function* () {
    const files: FileChange[] = [];
    const { desired, removals, automation, snapshot, packageConflict } = context;
    for (const relative of [
      ...new Set([...desired.keys(), ...removals.keys(), ...automation.keys()]),
    ].toSorted()) {
      const before = snapshot.files[relative];
      assert(before !== undefined);
      const after = yield* plannedState(relative, before, context);
      const reasons =
        automation.get(relative)?.reasons ??
        desired.get(relative)?.reasons ??
        removals.get(relative);
      assert(reasons !== undefined);
      const packageAddition = relative === "package.json" && !packageConflict;
      files.push({
        path: relative,
        before,
        after,
        reasons,
        kind: fileKind(before, after, packageAddition),
        conflict: !equal(before, after) && before.kind === "file" && !packageAddition,
      });
    }
    return files;
  });
}

/** Build one deterministic plan from actual files. No writes, imports of target configs, or dependency operations. */
export function planProject(
  projectRoot: string,
  resolved: ResolvedInputs,
  options: PlanOptions,
): Effect.Effect<ChangePlan, PlanError> {
  return Effect.gen(function* () {
    const selected = orderedBundles(resolved.policy.bundles);
    const deselected = deselectedBundles(selected, options);
    const configs = yield* composeConfigurations(resolved.policy);
    const desired = new Map<string, DesiredFile>();
    for (const [relative, value] of Object.entries(configs)) {
      desired.set(relative, {
        content: jsonContent(value),
        executable: false,
        reasons: ["selected Oxc policy (replaces target configuration)"],
        json: value,
      });
    }
    yield* dedicatedFiles(selected, desired);
    desired.set(resolved.selectionFile.path, {
      content: resolved.selectionFile.content,
      executable: false,
      reasons: ["saved intended selections"],
    });
    const removals = yield* fileRemovals(selected, deselected, desired);
    const automation = yield* prepareAutomation(selected, deselected);
    const snapshot = yield* readTargetSnapshot(projectRoot, [
      "package.json",
      ...desired.keys(),
      ...removals.keys(),
      ...automation.paths,
    ]);
    const automationChanges = yield* automation.plan(snapshot);
    const packageFile = snapshot.files["package.json"];
    assert(packageFile !== undefined);
    const original = yield* decode("package.json", packageFile);
    const { manifest, packageEntries, changed } = yield* planManifest(
      original,
      selected,
      deselected,
      options,
    );
    desired.set("package.json", {
      content: jsonContent(manifest),
      executable: false,
      reasons: ["targeted package entries"],
      json: manifest,
    });
    const files = yield* fileChanges({
      snapshot,
      desired,
      removals,
      automation: automationChanges,
      manifestChanged: changed,
      packageConflict: packageEntries.some((entry) => entry.conflict),
    });
    return {
      snapshot,
      files,
      packageEntries,
      requiresConfirmation: files.some((file) => file.conflict),
      complete: true,
      deferred: [],
    };
  });
}
