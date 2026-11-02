import { Effect } from "effect";

import { orderedBundles } from "./composition.ts";
import { PlanError } from "./plan-errors.ts";
import type { PlanOptions, ScriptContext } from "./planning.ts";

/** Target-manager contract shared with dependency adapters. Scripts require POSIX /bin/sh. */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
const managers: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];
const prefix = "its-checks:";
type Contribution = { command: string; replacementSource?: string };
// Loaded bundle script names are restricted to alphanumerics, colon, underscore and hyphen.
const runner = (manager: PackageManager, helper: string) => `${manager} run ${helper}`;
// Two newlines terminate a last-line comment or a trailing escaped newline without inspecting shell syntax.
const group = (command: string) => `(\n${command}\n\n)`;

function recognize(command: string, helper: string): { original?: string } | undefined {
  for (const manager of managers) {
    const invocation = runner(manager, helper);
    if (command === invocation) return {};
    const end = `\n\n) && ${invocation}`;
    if (command.startsWith("(\n") && command.endsWith(end)) {
      return { original: command.slice(2, -end.length) };
    }
  }
  return undefined;
}

/** Compose the complete scripts map through the public read-only planning seam. No script is executed. */
export function createScriptPlanner(manager: PackageManager): NonNullable<PlanOptions["scripts"]> {
  return (context: ScriptContext) =>
    Effect.gen(function* () {
      const scripts: Record<string, string> = Object.assign(
        Object.create(null),
        context.manifest.scripts,
      );
      const selected = orderedBundles(context.selected);
      // Keep each ordinary contribution's identity and position until replacements resolve.
      const contributions = new Map<string, Map<string, Contribution>>();
      const known = new Set(
        [...context.selected, ...context.deselected].flatMap((bundle) =>
          Object.keys(bundle.declaration.scripts ?? {}),
        ),
      );
      for (const bundle of selected) {
        for (const [name, command] of Object.entries(bundle.declaration.scripts ?? {})) {
          if (typeof command !== "string") continue;
          const owners = contributions.get(name) ?? new Map<string, Contribution>();
          owners.set(bundle.key, { command });
          contributions.set(name, owners);
        }
      }
      for (const bundle of selected) {
        for (const [name, replacement] of Object.entries(bundle.declaration.scripts ?? {})) {
          if (typeof replacement === "string") continue;
          const target = contributions.get(name)?.get(replacement.replaces);
          const fail = (detail: string) =>
            Effect.fail(new PlanError({ source: bundle.source, field: `scripts.${name}`, detail }));
          if (!target)
            return yield* fail(
              `Replacement target ${replacement.replaces} does not supply an ordinary command for this script in the selected bundles.`,
            );
          if (target.replacementSource && target.command !== replacement.command) {
            return yield* fail(
              `Conflicting replacement for ${replacement.replaces}; another replacement is declared in ${target.replacementSource}.`,
            );
          }
          target.command = replacement.command;
          target.replacementSource ??= bundle.source;
        }
      }
      for (const name of [...known].sort()) {
        const helper = `${prefix}${name}`;
        const command = Object.hasOwn(scripts, name) ? scripts[name]! : undefined;
        const wrapper = command === undefined ? undefined : recognize(command, helper);
        const conflict = (detail: string) =>
          Effect.fail(new PlanError({ source: "package.json", field: `scripts.${name}`, detail }));
        if (!wrapper && command?.includes(helper)) {
          return yield* conflict(
            `Edited public command references ${helper} but is not an exact generated wrapper. Restore the generated wrapper, or manually remove the helper reference and rename/remove scripts.${helper}, then retry. No shell rewrite was attempted.`,
          );
        }
        if (!wrapper && Object.hasOwn(scripts, helper)) {
          return yield* conflict(
            `Reserved namespace collision at scripts.${helper}: no exact generated public wrapper identifies ownership. Rename/remove that entry (preserving any command you need), then retry.`,
          );
        }
        const owners = contributions.get(name);
        if (owners) {
          const commands = [...new Set([...owners.values()].map(({ command }) => command))];
          const original = wrapper ? wrapper.original : command;
          if (original?.includes("\0"))
            return yield* conflict("POSIX shell commands cannot contain NUL");
          scripts[helper] = commands.map(group).join(" && ");
          scripts[name] =
            original === undefined
              ? runner(manager, helper)
              : `${group(original)} && ${runner(manager, helper)}`;
        } else if (wrapper) {
          delete scripts[helper];
          if (wrapper.original === undefined) delete scripts[name];
          else scripts[name] = wrapper.original;
        }
      }
      return scripts;
    });
}
