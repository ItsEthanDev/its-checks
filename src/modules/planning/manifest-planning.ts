import { Effect } from "effect";

import {
  canonical,
  isObject,
  type JsonObject,
  type JsonValue,
  type LoadedBundle,
} from "../policy/index.ts";
import { PlanError } from "./plan-errors.ts";
import type { ChangeKind, DeferredChange, EntryChange, PlanOptions } from "./planning.ts";

const sections = ["dependencies", "devDependencies", "scripts"] as const;
const dependencySections = ["dependencies", "devDependencies"] as const;
type DependencySection = (typeof dependencySections)[number];
type Requirement = { requirement: string; section: DependencySection; source: string };
type DependencyEdit = { section: DependencySection; name: string; after: string | null };
const fail = (source: string, field: string, detail: string) =>
  new PlanError({ source, field, detail });

function requirements(selected: readonly LoadedBundle[]) {
  return Effect.gen(function* () {
    const required = new Map<string, Requirement>();
    for (const bundle of selected) {
      for (const section of dependencySections) {
        yield* addRequirements(required, bundle, section);
      }
    }
    return required;
  });
}
function addRequirements(
  required: Map<string, Requirement>,
  bundle: LoadedBundle,
  section: DependencySection,
) {
  return Effect.gen(function* () {
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
    return undefined;
  });
}
function dependencyEdits(
  required: ReadonlyMap<string, Requirement>,
  selected: readonly LoadedBundle[],
  deselected: readonly LoadedBundle[],
) {
  const edits = new Map<string, DependencyEdit>();
  const edit = (section: DependencySection, name: string, after: string | null) =>
    edits.set(`${section}/${name}`, { section, name, after });
  const removals = [
    ...deselected.flatMap((bundle) =>
      dependencySections.flatMap((section) =>
        Object.keys(bundle.declaration[section] ?? {}).map((name) => ({ section, name })),
      ),
    ),
    ...selected.flatMap(migrationDependencies),
  ];
  for (const { section, name } of removals) {
    if (!required.has(name)) {
      edit(section, name, null);
    }
  }
  for (const [name, entry] of required) {
    edit(entry.section, name, entry.requirement);
    edit(entry.section === "dependencies" ? "devDependencies" : "dependencies", name, null);
  }
  return [...edits.values()];
}
function migrationDependencies(bundle: LoadedBundle) {
  return dependencySections.flatMap((section) => {
    const names =
      section === "dependencies"
        ? bundle.declaration.migration?.removeDependencies
        : bundle.declaration.migration?.removeDevDependencies;
    return (names ?? []).map((name) => ({ section, name }));
  });
}
function applyDependencyEdits(
  manifest: Record<string, JsonValue>,
  edits: readonly DependencyEdit[],
) {
  for (const { section, name, after } of edits) {
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
function entryChanges(
  original: JsonObject,
  manifest: JsonObject,
  edits: readonly DependencyEdit[],
) {
  const result: EntryChange[] = [];
  for (const section of sections) {
    const originalEntries = original[section];
    const manifestEntries = manifest[section];
    const before = isObject(originalEntries) ? originalEntries : {};
    const after = isObject(manifestEntries) ? manifestEntries : {};
    const names = new Set([
      ...Object.keys(before),
      ...Object.keys(after),
      ...edits.filter((entry) => entry.section === section).map((entry) => entry.name),
    ]);
    for (const name of [...names].toSorted()) {
      const a = stringEntry(before, name);
      const b = stringEntry(after, name);
      result.push({
        section,
        name,
        before: a,
        after: b,
        kind: kind(a, b),
        conflict: a !== null && a !== b,
      });
    }
  }
  return result;
}
function stringEntry(entries: JsonObject, name: string) {
  const value = Object.hasOwn(entries, name) ? entries[name] : undefined;
  return typeof value === "string" ? value : null;
}
function validateManifest(original: JsonValue) {
  return Effect.gen(function* () {
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
    return original;
  });
}

/** Compose package entries while preserving unrelated manifest fields and commands. */
export function planManifest(
  value: JsonValue,
  selected: readonly LoadedBundle[],
  deselected: readonly LoadedBundle[],
  options: PlanOptions,
): Effect.Effect<
  {
    manifest: JsonObject;
    packageEntries: readonly EntryChange[];
    deferred: readonly DeferredChange[];
    changed: boolean;
  },
  PlanError
> {
  return Effect.gen(function* () {
    const original = yield* validateManifest(value);
    const manifest: Record<string, JsonValue> = { ...original };
    const required = yield* requirements(selected);
    const edits = dependencyEdits(required, selected, deselected);
    applyDependencyEdits(manifest, edits);
    const deferred: DeferredChange[] = [];
    if (options.scripts !== undefined) {
      const scripts = yield* options.scripts({ manifest, selected, deselected });
      if (Object.hasOwn(manifest, "scripts") || Object.keys(scripts).length > 0) {
        manifest.scripts = scripts;
      }
    } else {
      const names = new Set(
        [...selected, ...deselected].flatMap((bundle) =>
          Object.keys(bundle.declaration.scripts ?? {}),
        ),
      );
      for (const name of [...names].toSorted()) {
        deferred.push({
          path: `package.json#scripts.${name}`,
          reason: "Script composition requires the #6 adapter; existing scripts remain untouched",
        });
      }
    }
    return {
      manifest,
      packageEntries: entryChanges(original, manifest, edits),
      deferred,
      changed: canonical(original) !== canonical(manifest),
    };
  });
}
