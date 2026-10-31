# Change policy in a fork

Edit native files and declarations under `policy/`. Rerun the source CLI from a disposable target package to inspect and apply your changes. Policy is loaded afresh on each invocation; no installer edits or rebuild are needed.

## Choose the right file

| Change | Edit |
| --- | --- |
| Formatting options | `typescript/base/files/.oxfmtrc.json` |
| Lint rules | `typescript/base/files/.oxlintrc.json` |
| Tailwind sorting/rules | `typescript/integrations/tailwind/files/` |
| Scripts, exact dependencies, display text | That bundle's `bundle.json` |
| Pre-commit command | `typescript/automation/husky/files/.husky/its-checks-pre-commit` |
| CI steps/commands | `typescript/automation/github-actions/files/.github/workflows/its-checks.yml` |
| Source/schema identity | Root `bundle.json` |

`files/` mirrors target paths. Keep Oxc configuration as JSON/JSONC, hooks as shell, and workflows as YAML. Do not create `files/package.json`: declarations use familiar `scripts`, `dependencies`, and `devDependencies` maps so unrelated manifest entries survive. Keep the `# its-checks: managed` comment on dedicated automation files. The shared `.husky/pre-commit` invocation block is installer-managed; author its separate invoked file instead.

For example, change baseline `semi` to `false`, or add `"tailwindcss/no-arbitrary-value": "error"` to the integration's native rules. To expose another integration, add `typescript/integrations/<lowercase-hyphenated-id>/bundle.json` with a `name`, plus optional `files/`. Discovery supplies the checkbox without a registry change. `npm test` proves edits to native baseline/integration, scripts, dependencies, hook/workflow commands, and a newly discovered directory reach applied output using only policy changes.

## Compose without a patch language

Baseline applies first, then integrations by ID, then automation by ID. [The composition table](planning.md#native-composition) is authoritative: rule entries replace whole entries; plugins/JS plugins/extends deduplicate in order; overrides append; settings merge only one level; other options replace whole values. Paths refer to the target root. Native output is standalone and never extends files in this checkout.

Same-name scripts compose sequentially, with exact command deduplication and stop-on-failure behavior. Do not declare reserved `its-checks:` helper scripts yourself. Use POSIX shell commands; use `node --run <public-name>` to invoke other project commands without prescribing npm. Keep lifecycle names consistent with tested managers: the shipped Husky contribution is **postinstall**, because Bun does not provide the same root `prepare` contract. Dependency requirements must agree literally across bundles; disagreements fail planning.

## Ask only for project facts

A bundle can declare typed `inputs` bound to existing JSON/JSONC fields. Native defaults are opinions, not implicit questions. See [input metadata and binding](saved-intent.md) and [declaration syntax](bundle-loading.md#bundle-declaration).

Tailwind currently has two path inputs because each input has one destination. Enter the same target-relative stylesheet path for both. Both default to `src/styles.css`; saved answers prefill on rerun. The stylesheet must exist when tools run and import `tailwindcss`. No YAML/shell interpolation or inferred integration detection exists. Do not add an executable installer to work around these limits.

## Migration and cleanup

Declare exact `migration.removeFiles`, `removeDependencies`, or `removeDevDependencies` entries beside the bundle that needs them. Removals appear in the confirmation plan. Existing executable configs are never imported to inspect them. The shipped baseline lists a small explicit set of competing Prettier/ESLint config names and the Prettier dev dependency; it does not guess other names or remove arbitrary scripts. ESLint dependencies are deliberately not removed: the Tailwind plugin declares an ESLint peer, and npm may install it. No ESLint runner/configuration is generated.

Renamed or vanished policy entries can remain for manual cleanup. Deselect cleanup knows prior IDs and **current** declarations, not old bundle versions. Removing Husky policy preserves unrelated hook content but does not undo Husky's `core.hooksPath` or `.husky/_` lifecycle effects. If retiring Husky completely, inspect other hooks before manually changing that Git setting or removing its dispatch files. Dedicated unmarked workflow/hook destinations are hard conflicts, not overwrite candidates. See [automation preservation](automation.md).

## Pin provenance honestly

The shipped root uses `https://github.com/ItsEthanDev/its-checks` and schema revision `85e709004b65df77a1fa13ac8f7c119784c82602`, a known **local** commit containing `schemas/selections.schema.json`. Here `source.revision` pins the schema, not the executing checkout's current revision. Record the actual checkout separately with `git rev-parse HEAD`; uncommitted policy edits have no commit identity. Do not invent a self-referential current hash.

For a fork, change the repository URL and schema's descriptive repository link, commit the schema, then pin metadata to that known schema-containing commit. Remote availability is a publication gate: a local commit/hash does not prove the generated `<repository>/raw/<revision>/schemas/selections.schema.json` URL resolves. Runtime loading remains offline.

Before accepting new tool versions or rules, rerun [real compatibility checks](policy-compatibility.md). Successful agent tests do not replace the [owner's independent editing pass](owner-acceptance.md).
