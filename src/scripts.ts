import { Effect } from "effect";
import { orderedBundles } from "./composition.ts";
import { PlanError } from "./plan-errors.ts";
import type { PlanOptions, ScriptContext } from "./planning.ts";

/** Target-manager contract shared with dependency adapters. Scripts require POSIX /bin/sh. */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
const managers: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];
const prefix = "its-checks:";
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
  return (context: ScriptContext) => Effect.gen(function*() {
    const scripts: Record<string, string> = Object.assign(Object.create(null), context.manifest.scripts);
    const contributions = new Map<string, string[]>();
    const known = new Set([...context.selected, ...context.deselected]
      .flatMap((bundle) => Object.keys(bundle.declaration.scripts ?? {})));
    for (const bundle of orderedBundles(context.selected)) {
      for (const [name, command] of Object.entries(bundle.declaration.scripts ?? {})) {
        const commands = contributions.get(name) ?? [];
        if (!commands.includes(command)) commands.push(command);
        contributions.set(name, commands);
      }
    }
    for (const name of [...known].sort()) {
      const helper = `${prefix}${name}`;
      const command = Object.hasOwn(scripts, name) ? scripts[name]! : undefined;
      const wrapper = command === undefined ? undefined : recognize(command, helper);
      const conflict = (detail: string) => Effect.fail(new PlanError({ source: "package.json", field: `scripts.${name}`, detail }));
      if (!wrapper && command?.includes(helper)) {
        return yield* conflict(`Edited public command references ${helper} but is not an exact generated wrapper. Restore the generated wrapper, or manually remove the helper reference and rename/remove scripts.${helper}, then retry. No shell rewrite was attempted.`);
      }
      if (!wrapper && Object.hasOwn(scripts, helper)) {
        return yield* conflict(`Reserved namespace collision at scripts.${helper}: no exact generated public wrapper identifies ownership. Rename/remove that entry (preserving any command you need), then retry.`);
      }
      const commands = contributions.get(name);
      if (commands) {
        const original = wrapper ? wrapper.original : command;
        if (original?.includes("\0")) return yield* conflict("POSIX shell commands cannot contain NUL");
        scripts[helper] = commands.map(group).join(" && ");
        scripts[name] = original === undefined ? runner(manager, helper) : `${group(original)} && ${runner(manager, helper)}`;
      } else if (wrapper) {
        delete scripts[helper];
        if (wrapper.original === undefined) delete scripts[name];
        else scripts[name] = wrapper.original;
      }
    }
    return scripts;
  });
}
