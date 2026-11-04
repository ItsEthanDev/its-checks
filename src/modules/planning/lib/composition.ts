import { Effect, Schema } from "effect";

import { canonical, compare } from "../../policy/documents.ts";
import type { JsonValue, LoadedBundle, NativeFile } from "../../policy/index.ts";
import { conflict, field, fieldAt, merge, setField } from "./json-composition.ts";
import { PlanError } from "./plan-errors.ts";
export { composeTarget } from "./json-composition.ts";

/** Dependencies precede dependents; unrelated bundles use source-qualified lexical order. */
export function orderedBundles(bundles: readonly LoadedBundle[]): readonly LoadedBundle[] {
  const result: LoadedBundle[] = [];
  const done = new Set<string>();
  const visit = (bundle: LoadedBundle) => {
    if (done.has(bundle.key)) {
      return;
    }
    done.add(bundle.key);
    for (const id of (bundle.declaration.requires ?? []).toSorted()) {
      const dependency = bundles.find(
        (candidate) => candidate.key === `${bundle.repository}:${id}`,
      );
      if (dependency !== undefined) {
        visit(dependency);
      }
    }
    result.push(bundle);
  };
  for (const bundle of bundles.toSorted((a, b) => compare(a.key, b.key))) {
    visit(bundle);
  }
  return result;
}
export interface Contribution {
  readonly file: NativeFile;
  readonly owners: readonly string[];
}
type Authored = { readonly bundle: LoadedBundle; file: NativeFile };
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
function replaceFields(
  contributions: Authored[],
  entry: Authored,
  replacements: Map<string, JsonValue>,
) {
  const { bundle, file } = entry;
  for (const [at, targetId] of Object.entries(file.replaces)) {
    const target = contributions.find(
      (candidate) =>
        candidate.bundle.key === `${bundle.repository}:${targetId}` &&
        candidate.file.path === file.path,
    );
    if (
      target === undefined ||
      target.file.operation !== "compose" ||
      target.file.format === "text" ||
      file.format === "text"
    ) {
      conflict(
        file.source,
        at,
        "Replacement requires a selected ordinary contribution from the same source",
      );
    }
    if (Object.keys(target.file.replaces).some((other) => overlaps(other, at))) {
      conflict(file.source, at, "Replacement chains are unsupported");
    }
    const replacement = field(file.value, at, file.source);
    field(target.file.value, at, target.file.source);
    const identity = `${target.bundle.key}:${file.path}:${at}`;
    if ([...replacements.keys()].some((other) => other !== identity && overlaps(other, identity))) {
      conflict(file.source, at, "Overlapping replacements");
    }
    const earlier = replacements.get(identity);
    if (earlier !== undefined && canonical(earlier) !== canonical(replacement)) {
      conflict(file.source, at, "Conflicting replacements");
    }
    replacements.set(identity, replacement);
    target.file = {
      ...target.file,
      value: setField(target.file.value, at, replacement, file.source),
    };
  }
}
function activeArrays(file: NativeFile): NativeFile {
  if (file.format === "text") {
    return file;
  }
  const value = file.value;
  return {
    ...file,
    arrays: Object.fromEntries(
      Object.entries(file.arrays).filter(([at]) => fieldAt(value, at) !== undefined),
    ),
  };
}
function compositionArrays(a: NativeFile, b: NativeFile, source: string) {
  if (a.format === "text" || b.format === "text") {
    return {};
  }
  for (const at of new Set([...Object.keys(a.arrays), ...Object.keys(b.arrays)])) {
    if (
      fieldAt(a.value, at) !== undefined &&
      fieldAt(b.value, at) !== undefined &&
      a.arrays[at] !== b.arrays[at]
    ) {
      conflict(source, at, "Incompatible composition declarations for a shared array");
    }
  }
  return { ...a.arrays, ...b.arrays };
}
function addFile(files: Map<string, Contribution>, bundle: LoadedBundle, authored: NativeFile) {
  const file = activeArrays(authored);
  const previous = files.get(file.path);
  if (previous === undefined) {
    files.set(file.path, { file, owners: [bundle.key] });
    return;
  }
  const a = previous.file;
  const source = `${previous.owners.join(", ")} and ${bundle.key} (${file.source})`;
  if (a.operation !== file.operation || a.executable !== file.executable) {
    conflict(source, file.path, "Incompatible file operations or composition declarations");
  }
  let combined = file;
  if (file.operation === "compose" && file.format !== "text" && a.format !== "text") {
    const arrays = compositionArrays(a, file, source);
    combined = { ...file, arrays, value: merge(a.value, file.value, { arrays, source }) };
  } else if (a.content !== file.content) {
    conflict(source, file.path, "Different complete-file contributions");
  }
  files.set(file.path, { file: combined, owners: [...previous.owners, bundle.key] });
}
function checkDestinations(files: ReadonlyMap<string, Contribution>) {
  const paths = [...files.keys()].toSorted();
  const folded = new Set<string>();
  for (const relative of paths) {
    if (
      folded.has(relative.toLowerCase()) ||
      paths.some(
        (other) =>
          other !== relative && relative.toLowerCase().startsWith(`${other.toLowerCase()}/`),
      )
    ) {
      conflict(relative, "$", "Overlapping or case-aliased destinations");
    }
    folded.add(relative.toLowerCase());
  }
}
export function collectFiles(
  bundles: readonly LoadedBundle[],
): Effect.Effect<ReadonlyMap<string, Contribution>, PlanError> {
  return Effect.try({
    try: () => {
      const files = new Map<string, Contribution>();
      const contributions = orderedBundles(bundles).flatMap((bundle) =>
        bundle.files.map((file) => ({ bundle, file })),
      );
      const replacements = new Map<string, JsonValue>();
      for (const entry of contributions) {
        replaceFields(contributions, entry, replacements);
      }
      for (const { bundle, file } of contributions) {
        addFile(files, bundle, file);
      }
      checkDestinations(files);
      return files;
    },
    catch: (cause) =>
      Schema.is(PlanError)(cause)
        ? cause
        : new PlanError({ source: "composition", field: "$", detail: String(cause) }),
  });
}
