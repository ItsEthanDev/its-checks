# Native automation preservation

`planProject` includes automation in the same snapshot and confirmation plan as configuration and manifest changes. `applyPlan` applies those exact approved bytes; it does not run hooks, workflows, GitHub Actions, or deployment commands. No automation adapter option is needed.

## Author dedicated native files

Put native files at their target-relative paths inside a bundle's `files/` directory. These conventions apply to baseline, integrations, and automation bundles alike; bundle IDs do not select installer behavior.

- Workflows use dedicated destinations under `.github/workflows/`, for example `.github/workflows/quality.yml`. Do not supply jobs intended for insertion into another workflow.
- Pre-commit commands live in `.husky/its-checks-pre-commit`. Do not supply `.husky/pre-commit` or other shared Husky files as native outputs. The installer owns only the invocation mechanism in the shared hook.
- Each dedicated file must start with the exact line `# its-checks: managed`. A shell shebang may precede that line. LF and CRLF are accepted. This comment identifies ownership without a historical manifest; keep it when editing generated content.

For example, a fork can author this dedicated shell file:

```sh
#!/bin/sh
# its-checks: managed
npm run check
```

The command is illustrative policy, not an installer default. Shell and YAML bytes are copied as authored, without input substitution or command interpretation. The policy loader validates YAML syntax; the installer does not execute or validate the commands' runtime behavior. Existing file permissions are retained; new dedicated files use the policy's executable flag.

Identical selected contributions can share a destination. Different bytes or executable flags at one destination fail with both sources, rather than choosing a winner.

## Shared pre-commit block

The installer appends exactly one block to `.husky/pre-commit`:

```sh
# BEGIN its-checks
sh .husky/its-checks-pre-commit
# END its-checks
```

The block invokes the separate policy-authored file. The installer does not prescribe the commands inside that file. New shared hooks are executable; existing modes are preserved.

For reversible insertion, a block appended after existing content owns **one preceding line separator**, and no separator after its END delimiter. The installer adds that separator even if the original hook ends with a newline. It uses CRLF when the existing hook contains CRLF, otherwise LF. The generated END line has no final newline. Removing the block restores the original surrounding bytes, including an originally missing final newline. A block beginning at byte zero has no preceding separator. If you move a block manually, retain this separator convention.

An intact delimiter pair identifies the managed region even when its invocation was edited. Updating it requires confirmation when existing bytes change. Commands and line endings outside that region remain untouched. Disabling removes the block, not the shared file; an empty hook may remain because there is no historical record of whether that file existed before installation.

Only one ordered BEGIN/END pair on exact whole lines is accepted. Missing, reversed, duplicated, nested, indented, or otherwise altered recognizable delimiters fail before mutation. Restore one pair or remove the delimiters manually before retrying. The installer does not infer ownership from shell commands without delimiters.

## Conflicts, migration, and deselection

An existing dedicated destination must carry the native ownership comment. Unmarked content is an actionable **hard conflict**, not a replaceable file even with generic plan confirmation. Move or rename the unrelated file, or change the policy destination, then replan. This rule also protects explicit migration and deselection removals. Unlisted workflows are never inspected or modified.

Marked dedicated content can be updated or removed with the normal plan-level confirmation, including local edits. Removing its ownership comment makes it unrelated and blocks replacement/removal. Adding the comment manually explicitly adopts a dedicated file into this convention; the installer does not do that automatically.

Cleanup uses prior intended selections and currently loaded bundle definitions. Selected requirements survive another bundle's deselection. Explicit selected `migration.removeFiles` declarations can remove identifiable dedicated automation; a declaration for `.husky/pre-commit` removes only its block. Migration cannot remove a selected output or its required invocation.

Unknown/retired bundles and paths no longer present in current definitions are not reconstructed. Renamed workflows can remain for manual cleanup. No ownership inventory, backups, arbitrary shell parser, YAML merger, or templating DSL is used.

## Verification and limits

`test/automation.test.ts` exercises public planning/application with real temporary native policy: enable, matching rerun, native and local edits, confirmation decline, hard conflicts, disable, shared requirements, migration, malformed blocks, CRLF, missing final newlines, unrelated commands/workflows, stale snapshots, and current-known/no-history cleanup. Dependency operations are substituted at the application seam. Tests do not install dependencies, execute hooks or Actions, or establish Husky/GitHub runtime compatibility. Filesystem concurrency and partial-application limits remain those of [application](application.md).
