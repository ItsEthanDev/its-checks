import assert from "node:assert/strict";
import { TextDecoder } from "node:util";

import { Effect } from "effect";

import { isAutomationPath, prepareAutomation } from "./automation.ts";
import { json } from "./bundle-loading.ts";
import type { JsonValue, LoadedBundle } from "./bundles.ts";
import {
  canonical,
  composeConfigurations,
  configDestination,
  isObject,
  jsonContent,
  orderedBundles,
  type JsonObject,
} from "./composition.ts";
import type { ResolvedInputs } from "./inputs.ts";
import { PlanError } from "./plan-errors.ts";
import type { SavedIntent } from "./selections.ts";
import { readTargetSnapshot, type FileState, type TargetSnapshot } from "./target-snapshot.ts";

export { PlanError } from "./plan-errors.ts";
export { assertTargetUnchanged, readTargetSnapshot } from "./target-snapshot.ts";
export type { FileState, TargetSnapshot } from "./target-snapshot.ts";
export type ChangeKind = "creation" | "addition" | "replacement" | "removal" | "noop";
export interface EntryChange {
  readonly section: "dependencies" | "devDependencies" | "scripts";
  readonly name: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly kind: ChangeKind;
  readonly conflict: boolean;
}
export interface FileChange {
  readonly path: string;
  readonly before: FileState;
  readonly after: FileState;
  readonly kind: ChangeKind;
  readonly conflict: boolean;
  readonly reasons: readonly string[];
}
export interface DeferredChange {
  readonly path: string;
  readonly reason: string;
}
export interface ChangePlan {
  readonly snapshot: TargetSnapshot;
  readonly files: readonly FileChange[];
  readonly packageEntries: readonly EntryChange[];
  readonly requiresConfirmation: boolean;
  /** False while declared scripts lack their planner adapter. Never apply an incomplete plan. */
  readonly complete: boolean;
  readonly deferred: readonly DeferredChange[];
}
export interface ScriptContext {
  readonly manifest: JsonObject;
  readonly selected: readonly LoadedBundle[];
  readonly deselected: readonly LoadedBundle[];
}
export interface PlanOptions {
  readonly previous?: SavedIntent;
  /** Current, loaded bundles only. Missing/retired historical bundles are deliberately not reconstructed. */
  readonly currentBundles?: readonly LoadedBundle[];
  /** #6 owns composition; return the complete scripts map, preserving unrelated commands. */
  readonly scripts?: (
    context: ScriptContext,
  ) => Effect.Effect<Readonly<Record<string, string>>, PlanError>;
}
const sections = ["dependencies", "devDependencies", "scripts"] as const;
// Explicit competing names, not a search heuristic or a released-version discovery claim.
const alternates = ["oxfmt", "oxlint"].flatMap((tool) =>
  [`.${tool}rc.jsonc`].concat(
    ["ts", "mts", "cts", "js", "mjs", "cjs"].map((extension) => `${tool}.config.${extension}`),
  ),
);
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
const kind = (before: string | null, after: string | null): ChangeKind => {
  if (before === after) {
    return "noop";
  }
  if (before === null) {
    return "addition";
  }
  return after === null ? "removal" : "replacement";
};

/** Build one deterministic plan from actual files. No writes, imports of target configs, or dependency operations. */
export function planProject(
  projectRoot: string,
  resolved: ResolvedInputs,
  options: PlanOptions = {},
): Effect.Effect<ChangePlan, PlanError> {
  return Effect.gen(function* () {
    const selected = orderedBundles(resolved.policy.bundles);
    const selectedKeys = new Set(selected.map((bundle) => bundle.key));
    const previousKeys = new Set([
      ...(options.previous?.integrations.map((id) => `integrations/${id}`) ?? []),
      ...(options.previous?.automation.map((id) => `automation/${id}`) ?? []),
    ]);
    const deselected = orderedBundles(options.currentBundles ?? []).filter(
      (bundle) => previousKeys.has(bundle.key) && !selectedKeys.has(bundle.key),
    );
    const configs = yield* composeConfigurations(resolved.policy);
    const desired = new Map<
      string,
      { content: string; executable: boolean; reasons: string[]; json?: JsonValue }
    >();
    for (const [relative, value] of Object.entries(configs)) {
      desired.set(relative, {
        content: jsonContent(value),
        executable: false,
        reasons: ["selected Oxc policy (replaces target configuration)"],
        json: value,
      });
    }
    const deferred: DeferredChange[] = [];
    const defer = (relative: string, reason: string) => {
      deferred.push({ path: relative, reason });
    };
    for (const bundle of selected) {
      for (const file of bundle.files) {
        if (configDestination(file.path) !== undefined) {
          continue;
        }
        if (isAutomationPath(file.path)) {
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
    desired.set(resolved.selectionFile.path, {
      content: resolved.selectionFile.content,
      executable: false,
      reasons: ["saved intended selections"],
    });
    const removals = new Map<string, string[]>();
    const remove = (relative: string, reason: string) => {
      if (isAutomationPath(relative)) {
        return;
      }
      removals.set(relative, [...(removals.get(relative) ?? []), reason]);
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
    if (!isObject(original)) {
      return yield* fail("package.json", "$", "Expected an object");
    }
    for (const section of sections) {
      const entries = original[section];
      if (
        entries !== undefined &&
        (!isObject(entries) || Object.values(entries).some((value) => typeof value !== "string"))
      ) {
        return yield* fail("package.json", section, "Expected an object of strings");
      }
    }
    const manifest: Record<string, JsonValue> = { ...original };
    const required = new Map<
      string,
      { requirement: string; section: "dependencies" | "devDependencies"; source: string }
    >();
    for (const bundle of selected) {
      for (const section of ["dependencies", "devDependencies"] as const) {
        for (const [name, requirement] of Object.entries(bundle.declaration[section] ?? {})) {
          const source = `${bundle.key} (${bundle.declaration.name}, ${bundle.source})`;
          const earlier = required.get(name);
          if (earlier !== undefined && earlier.requirement !== requirement) {
            return yield* fail(
              bundle.source,
              `${section}.${name}`,
              `Dependency ${name}: ${earlier.source} requires ${canonical(earlier.requirement)}; ${source} requires ${canonical(requirement)}`,
            );
          }
          required.set(name, {
            requirement,
            source,
            section: earlier?.section === "dependencies" ? "dependencies" : section,
          });
        }
      }
    }
    const edits = new Map<
      string,
      { section: "dependencies" | "devDependencies"; name: string; after: string | null }
    >();
    const edit = (
      section: "dependencies" | "devDependencies",
      name: string,
      after: string | null,
    ) => edits.set(`${section}/${name}`, { section, name, after });
    for (const bundle of deselected) {
      for (const section of ["dependencies", "devDependencies"] as const) {
        for (const name of Object.keys(bundle.declaration[section] ?? {})) {
          if (!required.has(name)) {
            edit(section, name, null);
          }
        }
      }
    }
    for (const bundle of selected) {
      for (const section of ["dependencies", "devDependencies"] as const) {
        const migration =
          section === "dependencies"
            ? bundle.declaration.migration?.removeDependencies
            : bundle.declaration.migration?.removeDevDependencies;
        for (const name of migration ?? []) {
          if (!required.has(name)) {
            edit(section, name, null);
          }
        }
      }
    }
    for (const [name, entry] of required) {
      edit(entry.section, name, entry.requirement);
      edit(entry.section === "dependencies" ? "devDependencies" : "dependencies", name, null);
    }
    for (const { section, name, after } of edits.values()) {
      const prior = manifest[section];
      const entries = { ...(isObject(prior) ? prior : {}) };
      if (after === null) {
        delete entries[name];
      } else {
        entries[name] = after;
      }
      // Do not add an empty section just to delete an absent entry.
      if (Object.hasOwn(manifest, section) || Object.keys(entries).length > 0) {
        manifest[section] = entries;
      }
    }
    if (options.scripts !== undefined) {
      const scripts = yield* options.scripts({ manifest, selected, deselected });
      if (Object.hasOwn(manifest, "scripts") || Object.keys(scripts).length > 0) {
        manifest.scripts = scripts;
      }
    } else {
      for (const name of [
        ...new Set(
          [...selected, ...deselected].flatMap((bundle) =>
            Object.keys(bundle.declaration.scripts ?? {}),
          ),
        ),
      ].toSorted()) {
        defer(
          `package.json#scripts.${name}`,
          "Script composition requires the #6 adapter; existing scripts remain untouched",
        );
      }
    }
    const packageEntries: EntryChange[] = [];
    for (const section of sections) {
      const originalEntries = original[section];
      const manifestEntries = manifest[section];
      const before = isObject(originalEntries) ? originalEntries : {};
      const after = isObject(manifestEntries) ? manifestEntries : {};
      const names = new Set([
        ...Object.keys(before ?? {}),
        ...Object.keys(after ?? {}),
        ...[...edits.values()]
          .filter((entry) => entry.section === section)
          .map((entry) => entry.name),
      ]);
      for (const name of [...names].toSorted()) {
        const previousValue = Object.hasOwn(before, name) ? before[name] : undefined;
        const nextValue = Object.hasOwn(after, name) ? after[name] : undefined;
        const a = typeof previousValue === "string" ? previousValue : null;
        const b = typeof nextValue === "string" ? nextValue : null;
        packageEntries.push({
          section,
          name,
          before: a,
          after: b,
          kind: kind(a, b),
          conflict: a !== null && a !== b,
        });
      }
    }
    const manifestChanged = canonical(original) !== canonical(manifest);
    desired.set("package.json", {
      content: jsonContent(manifest),
      executable: false,
      reasons: ["targeted package entries"],
      json: manifest,
    });
    const files: FileChange[] = [];
    for (const relative of [
      ...new Set([...desired.keys(), ...removals.keys(), ...automationChanges.keys()]),
    ].toSorted()) {
      const before = snapshot.files[relative];
      assert(before !== undefined);
      const output = desired.get(relative);
      const automationChange = automationChanges.get(relative);
      let after: FileState =
        automationChange?.after ??
        (output !== undefined
          ? state(output.content, before, output.executable)
          : { kind: "absent" });
      if (relative === "package.json" && !manifestChanged) {
        after = before;
      } else if (output?.json !== undefined && before.kind === "file") {
        const parsed = yield* decode(relative, before).pipe(Effect.orElseSucceed(() => undefined));
        if (parsed !== undefined && canonical(parsed) === canonical(output.json)) {
          after = before;
        }
      }
      const unchanged = equal(before, after);
      let fileKind: ChangeKind = "replacement";
      if (unchanged) {
        fileKind = "noop";
      } else if (before.kind === "absent") {
        fileKind = "creation";
      } else if (after.kind === "absent") {
        fileKind = "removal";
      } else if (relative === "package.json" && !packageEntries.some((entry) => entry.conflict)) {
        fileKind = "addition";
      }
      const reasons = automationChange?.reasons ?? output?.reasons ?? removals.get(relative);
      assert(reasons !== undefined);
      files.push({
        path: relative,
        before,
        after,
        kind: fileKind,
        conflict:
          !unchanged &&
          before.kind === "file" &&
          (relative !== "package.json" || packageEntries.some((entry) => entry.conflict)),
        reasons,
      });
    }
    const uniqueDeferred = deferred
      .filter(
        (entry, index) =>
          deferred.findIndex(
            (other) => other.path === entry.path && other.reason === entry.reason,
          ) === index,
      )
      .toSorted((a, b) => {
        if (a.path !== b.path) {
          return a.path < b.path ? -1 : 1;
        }
        if (a.reason === b.reason) {
          return 0;
        }
        return a.reason < b.reason ? -1 : 1;
      });
    return {
      snapshot,
      files,
      packageEntries,
      requiresConfirmation: files.some((file) => file.conflict),
      complete: uniqueDeferred.length === 0,
      deferred: uniqueDeferred,
    };
  });
}
