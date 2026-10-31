# Package script composition

`createScriptPlanner(manager)` from `src/scripts.ts` supplies the `PlanOptions.scripts` adapter. Pass the target package manager explicitly; this module does not detect managers or execute commands.

```ts
import { createScriptPlanner } from "../src/scripts.ts";

const plan = yield* planProject(projectRoot, resolved, {
  previous: previousIntent,
  currentBundles: currentlyLoadedKnownBundles,
  scripts: createScriptPlanner("pnpm"),
});
```

`PackageManager` is the shared target-manager type: `"npm" | "pnpm" | "yarn" | "bun"`. Each runner uses `<manager> run its-checks:<name>`. Manager detection, dependency installation, and real manager lifecycle behavior belong to the package-manager adapter, not this composer.

## Bundle author contract

Declare ordinary `scripts` maps in `bundle.json`. All public names, including `check` and `prepare`, use the same mechanism. The loader accepts names starting with an ASCII letter or digit, followed by letters, digits, colons, underscores, or hyphens. The `its-checks:` namespace is reserved and cannot be declared by bundles. Commands must be nonblank and cannot contain NUL.

Composition uses baseline first, integrations in ordinal ID order, then automation in ordinal ID order. Exact duplicate command strings execute once, at their first position. Different strings remain distinct even if they have equivalent shell behavior.

Every selected name gets a helper, even for a single contribution and an initially absent public command. For example:

```json
{
  "scripts": {
    "check": "pnpm run its-checks:check",
    "its-checks:check": "(\noxfmt --check .\n\n) && (\noxlint .\n\n)"
  }
}
```

Each expression is enclosed in its own subshell and joined with ` && `. The original public command, when present, is also grouped and runs first:

```json
{
  "scripts": {
    "check": "(\nnode scripts/custom-check.mjs\n\n) && pnpm run its-checks:check",
    "its-checks:check": "(\noxlint .\n\n)"
  }
}
```

The newlines are part of the exact generated form. The two newlines before `)` keep a last-line comment or trailing line continuation from consuming the closing delimiter. Original command bytes remain intact inside the wrapper. No shell parser splits, normalizes, or rewrites expressions, including `&&`, `||`, semicolons, pipelines, nested subshells, multiline commands, and here-documents. Each expression's exit status controls whether the next expression runs; a failing intermediate command inside an opaque expression may recover with `||` or a later successful command. Subshells isolate working-directory and environment changes between expressions.

Commands must be suitable for POSIX `/bin/sh`. The composer does not validate arbitrary shell programs. Invalid shell syntax still fails at execution. Commands needing another shell must invoke it explicitly.

## Reruns, cleanup, and conflicts

Only these public forms are recognized, for any of the four managers:

1. The exact helper runner, with no original command.
2. `(`, newline, original bytes, two newlines, `) && `, and the exact helper runner.

Recognition permits safe manager changes: the original bytes survive and the runner changes to the newly selected manager. Helpers are rebuilt from current selected policy, never appended to. A recognized wrapper identifies its helper even if the helper was deleted or edited. Deleted helpers are recreated when needed; edited helpers are normal replacement conflicts in the same plan-level confirmation as other changed entries.

If a public command mentions its corresponding helper but does not match either exact form, planning fails with instructions to restore the wrapper or manually remove the reference and rename/remove the helper. Equivalent-looking hand-written shell is not recognized. The installer does not guess a shell rewrite.

An existing helper without a recognized public wrapper is a reserved-namespace collision. Planning fails without deleting or adopting it, even when its bytes happen to match current policy. Rename/remove that entry, preserving any needed command, before retrying. Unrelated namespace entries whose public names are not currently identifiable remain untouched.

On deselection, pass prior intent and currently available bundle definitions as described in [planning](planning.md). If no selected bundle still contributes to an identifiable name, remove its helper and restore its original command exactly, or remove its public wrapper if there was no original. These removals require confirmation. Unwrapped public commands without helpers are preserved. No history or command backup is stored. Renamed/disappeared policy names and retired bundle definitions can leave old scripts for manual cleanup.

## Verified environment and limits

| Target manager | Generated runner | Shell evidence |
| --- | --- | --- |
| npm | `npm run its-checks:<name>` | Real Linux `/bin/sh`, fake local runner |
| pnpm | `pnpm run its-checks:<name>` | Real Linux `/bin/sh`, fake local runner |
| Yarn | `yarn run its-checks:<name>` | Real Linux `/bin/sh`, fake local runner |
| Bun | `bun run its-checks:<name>` | Real Linux `/bin/sh`, fake local runner |

`test/scripts.test.ts` exercises the public planner and executes its output in temporary projects. It verifies ordering, exact deduplication, compound original/contribution semantics, fail-fast behavior, restoration, idempotence, helper conflicts, runner arguments, and manager migration. Test-only runners read the planned helper and launch `/bin/sh`; they never install dependencies or run unrelated lifecycle scripts. The shared fixture's existing `install: exit 99` is preserved and never invoked.

This establishes shell composition and runner output, **not actual npm/pnpm/Yarn/Bun adapter compatibility or lifecycle behavior**. Real manager/version coverage belongs to the package-manager adapter. No Windows `cmd.exe`, PowerShell, custom package-manager script shell, macOS, or other OS execution is established by this suite. POSIX `/bin/sh` is the initial script-shell contract, not a claim of all-platform support.
