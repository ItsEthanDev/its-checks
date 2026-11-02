import { TextDecoder } from "node:util";

import { Effect, Schema } from "effect";

import type { LoadedBundle, NativeFile } from "./bundles.ts";
import { PlanError } from "./plan-errors.ts";
import type { FileState, TargetSnapshot } from "./target-snapshot.ts";

const hook = ".husky/pre-commit";
const dedicatedHook = ".husky/its-checks-pre-commit";
const ownership = "# its-checks: managed";
const begin = "# BEGIN its-checks";
const end = "# END its-checks";
export const isAutomationPath = (relative: string): boolean =>
  relative.startsWith(".husky/") || relative.startsWith(".github/workflows/");
const fail = (source: string, detail: string) => new PlanError({ source, field: "$", detail });
const owned = (text: string) => {
  const lines = text.split(/\r?\n/);
  return lines[0] === ownership || (lines[0]?.startsWith("#!") === true && lines[1] === ownership);
};
const text = (relative: string, file: FileState) => {
  try {
    return file.kind === "absent"
      ? ""
      : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          Buffer.from(file.base64, "base64"),
        );
  } catch {
    throw fail(relative, "Automation must be UTF-8; move unrelated content aside before retrying");
  }
};
const state = (content: string, before: FileState, executable = false): FileState => {
  let mode = executable ? 0o755 : 0o644;
  if (before.kind === "file") {
    mode = before.mode;
  }
  return { kind: "file", base64: Buffer.from(content).toString("base64"), mode };
};

/** Inspect only exact whole-line delimiters. Never parse or infer shell commands. */
function blockRange(content: string): { start: number; end: number } | undefined {
  const lines = [...content.matchAll(/[^\n]*(?:\n|$)/g)].filter((line) => line[0].length > 0);
  const markers = lines.filter((line) => line[0].includes(begin) || line[0].includes(end));
  if (markers.length === 0) {
    return undefined;
  }
  const [first, last] = markers;
  if (
    markers.length !== 2 ||
    first === undefined ||
    last === undefined ||
    first[0].replace(/\r?\n$/, "") !== begin ||
    last[0].replace(/\r?\n$/, "") !== end
  ) {
    throw fail(
      hook,
      "Malformed or duplicate its-checks block; restore exactly one ordered BEGIN/END pair on separate lines, or remove the delimiters manually and retry",
    );
  }
  let start = first.index;
  // The invocation block owns one preceding line separator, not any surrounding command bytes.
  if (start > 0) {
    start -= content.slice(0, start).endsWith("\r\n") ? 2 : 1;
  }
  return { start, end: last.index + last[0].replace(/\r?\n$/, "").length };
}
export interface AutomationChange {
  readonly after: FileState;
  readonly reasons: readonly string[];
}

/** Collect destinations before the planner takes its single complete snapshot. */
export function prepareAutomation(
  selected: readonly LoadedBundle[],
  deselected: readonly LoadedBundle[],
): Effect.Effect<
  {
    readonly paths: readonly string[];
    readonly plan: (
      snapshot: TargetSnapshot,
    ) => Effect.Effect<Map<string, AutomationChange>, PlanError>;
  },
  PlanError
> {
  return Effect.try({
    try: () => {
      const outputs = new Map<string, NativeFile>();
      const removals = new Set<string>();
      for (const bundle of selected) {
        for (const file of bundle.files.filter((candidate) => isAutomationPath(candidate.path))) {
          if (file.path.startsWith(".husky/") && file.path !== dedicatedHook) {
            throw fail(
              file.source,
              `Author the hook commands in ${dedicatedHook}; ${hook} is shared and only its invocation block is managed`,
            );
          }
          if (!owned(file.content)) {
            throw fail(
              file.source,
              `Dedicated automation requires ${ownership} as the first line (or immediately after a shell shebang)`,
            );
          }
          const prior = outputs.get(file.path);
          if (
            prior !== undefined &&
            (prior.content !== file.content || prior.executable !== file.executable)
          ) {
            throw fail(
              file.source,
              `Different dedicated automation contributions at ${file.path}: ${prior.source} and ${file.source}`,
            );
          }
          outputs.set(file.path, file);
        }
      }
      for (const bundle of selected) {
        for (const relative of bundle.declaration.migration?.removeFiles ?? []) {
          if (!isAutomationPath(relative)) {
            continue;
          }
          if (outputs.has(relative) || (relative === hook && outputs.has(dedicatedHook))) {
            throw fail(bundle.source, `Cannot remove selected automation output ${relative}`);
          }
          removals.add(relative);
        }
      }
      for (const bundle of deselected) {
        for (const file of bundle.files) {
          if (isAutomationPath(file.path) && !outputs.has(file.path)) {
            removals.add(file.path);
          }
        }
      }
      const manageHook =
        outputs.has(dedicatedHook) || removals.has(dedicatedHook) || removals.has(hook);
      const paths = [...new Set([...outputs.keys(), ...removals, ...(manageHook ? [hook] : [])])];
      return {
        paths,
        plan: (snapshot: TargetSnapshot) =>
          Effect.try({
            try: () => {
              const changes = new Map<string, AutomationChange>();
              for (const relative of paths) {
                if (relative === hook) {
                  continue;
                }
                const before = snapshot.files[relative];
                if (before === undefined) {
                  throw fail(relative, "Missing target snapshot");
                }
                if (before.kind === "file" && !owned(text(relative, before))) {
                  throw fail(
                    relative,
                    `Unrelated content at dedicated automation destination. Move or rename it, or choose another policy destination, then retry; confirmation cannot authorize replacement or removal`,
                  );
                }
                const output = outputs.get(relative);
                changes.set(relative, {
                  after:
                    output !== undefined
                      ? state(output.content, before, output.executable)
                      : { kind: "absent" },
                  reasons: [
                    output !== undefined
                      ? `native automation: ${output.source}`
                      : "identifiable automation cleanup",
                  ],
                });
              }
              if (manageHook) {
                const before = snapshot.files[hook];
                if (before === undefined) {
                  throw fail(hook, "Missing target snapshot");
                }
                const content = text(hook, before);
                const range = blockRange(content);
                const newline = content.includes("\r\n") ? "\r\n" : "\n";
                const invocation = `${begin}${newline}sh ${dedicatedHook}${newline}${end}`;
                const replacement = outputs.has(dedicatedHook)
                  ? `${range?.start === 0 || content.length === 0 ? "" : newline}${invocation}`
                  : "";
                let after = content;
                if (range !== undefined) {
                  after = content.slice(0, range.start) + replacement + content.slice(range.end);
                } else if (outputs.has(dedicatedHook)) {
                  after = content + replacement;
                }
                changes.set(hook, {
                  after:
                    before.kind === "absent" && after === "" ? before : state(after, before, true),
                  reasons: ["managed pre-commit invocation block; surrounding bytes preserved"],
                });
              }
              return changes;
            },
            catch: (cause) =>
              Schema.is(PlanError)(cause) ? cause : fail("automation", String(cause)),
          }),
      };
    },
    catch: (cause) => (Schema.is(PlanError)(cause) ? cause : fail("automation", String(cause))),
  });
}
