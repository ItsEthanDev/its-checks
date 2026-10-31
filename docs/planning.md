# Read-only change planning

`src/planning.ts` plans the current package only. It never writes files, installs dependencies, runs scripts, imports executable configuration, searches workspaces, or fetches presets/schemas. It uses Effect **4.1.1** and returns typed `PlanError` failures (`source`, `field`, `detail`). Loading and input binding retain their own `BundleError` failures.

## Interface

```ts
import { Effect } from "effect";
import { loadPolicy } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject } from "../src/planning.ts";

const planned = Effect.gen(function*() {
  const policy = yield* loadPolicy(policyRoot, selections);
  const resolved = yield* resolveInputs(policy, answers);
  return yield* planProject(projectRoot, resolved, {
    previous: previousIntent,
    currentBundles: currentlyLoadedKnownBundles,
  });
});
```

Pass a resolved policy and its generated selection file from [`resolveInputs`](saved-intent.md). Baseline applies first, followed by ordinal integration-ID order and ordinal automation-ID order. The planner orders bundles itself; selection-click order is irrelevant.

`previous` supplies prior selections, not proof of installation. `currentBundles` supplies currently available loaded bundle definitions for deselection identification. A caller can load still-available prior selections with `loadPolicy`; unknown/retired prior IDs must be excluded before that call. Deselection uses only definitions whose keys were previously selected and are no longer selected. It does not need former input answers to identify file paths or dependency names. No historical bundle version, ownership inventory, or backup is recorded.

The result contains:

- `snapshot`: absolute package root and every observed target path, including absent migration/config candidates and unchanged files;
- `files`: path-sorted operations with exact `before`/`after` states, `kind`, `conflict`, and reasons;
- `packageEntries`: section/name-ordered dependency/script entries with exact before/after string requirements (or `null` for absence), classifications, and conflict flags;
- `requiresConfirmation`: whether any operation replaces existing values or removes existing setup;
- `deferred` and `complete`: explicitly unplanned script work when its adapter is omitted. Automation is fully planned. **Do not apply an incomplete plan.**

File classifications are `creation`, `addition`, `replacement`, `removal`, and `noop`. Existing `package.json` with only new entries is an `addition`, not a conflicting replacement. Removing an absent entry/file is a no-op. Entry additions never conflict; changed existing entries and removals do. Dedicated-file replacements and existing saved-intent replacements conflict.

A file state is `{ kind: "absent" }` or `{ kind: "file", base64, mode }`. Base64 retains exact bytes, including executable migration files that are not UTF-8. `mode` retains permission bits; existing destination permissions are preserved, and new native files use `0755` when authored executable, otherwise `0644`. This is data for application, not an instruction to apply immediately.

`assertTargetUnchanged(plan.snapshot)` rereads **all** observations and fails if bytes, modes, or existence changed. Application must use the already-confirmed plan's `after` values, not recompute policy during execution. It must recheck before writes and handle interruption/partial failure itself. This preflight is not a transactional filesystem lock or rollback mechanism.

## Native composition

These are installer operations, **not** claims about Oxc native inheritance. Only selected policy contributes; existing target rules never participate. Both complete standalone `.oxfmtrc.json` and `.oxlintrc.json` are generated, even if an empty object is the only contribution.

Each bundle may supply either `.json` or `.jsonc` for each tool, not both. Both forms compose into the canonical `.json` destination. Generated JSON uses sorted object keys, two-space indentation, and a trailing newline. Array order is retained. Semantically matching existing Oxc JSON/JSONC objects retain their exact original bytes and mode, including comments and layout. Malformed dedicated Oxc JSON is a replacement candidate rather than a source of rules; malformed `package.json` stops planning.

| Tool/field | Installer operation |
| --- | --- |
| Oxlint `rules` | Merge by exact rule name. Later **whole entries** replace earlier entries, including severity/option tuples. Rule identities are not normalized. |
| Oxlint `categories`, `env`, `globals`, `settings`, `options` | Shallow merge by exact key. Each value is atomic; nested settings are not deep-merged. Explicit `false` is retained. |
| Oxlint `plugins`, `jsPlugins`, `extends` | Append in bundle order, deduplicate by exact JSON value (object-key order ignored). First occurrence wins its position. Different plugin aliases/specifiers remain distinct. No preset evaluation, package resolution, implicit default plugin expansion, or relative-path rebasing. |
| Both tools `overrides` | Append complete entries in bundle order. Do not merge or deduplicate overrides. |
| Oxfmt `extends` | Rejected: no supported native facility has been established. |
| Every other top-level field in either tool | Last supplied whole value wins. This includes `$schema`, `ignorePatterns`, formatter `associations`, `sortImports`, `sortTailwindcss`, structured option objects, and other option arrays. Omission contributes nothing. |

Map fields must be objects; list fields must be arrays. Other native fields remain opaque and are not checked against an Oxc schema here. Top-level `null` is an atomic value, not an installer deletion instruction. Paths in fragments, overrides, installed-package presets, and plugin entries are authored relative to the **target package root** and remain unchanged. The output does not reference generator-local policy fragments.

The [Oxc research](research/oxc-configuration.md) is not released-version proof. No tool version compatibility is asserted by this composer. [Shipped-policy compatibility](policy-compatibility.md) records separate released-package execution, accepted native options, and plugin evidence. Composition does not rely on undocumented native inheritance.

## Dependencies and the shared manifest

The root `package.json` must exist, be strict JSON with unique keys and an object root. Present `dependencies`, `devDependencies`, and `scripts` must be objects of strings. All unrelated root fields, scripts, dependencies, workspace declarations, optional/peer dependencies, and unlisted legacy setup retain their values. Formatting changes only when the manifest needs an actual value change; matching manifests retain exact bytes.

Requirements are compared as literal strings. Different selected-bundle requirements for one package fail, even if ranges overlap. The error names the package and both bundle keys, display names, declaration paths, and requirements. Existing project requirements are not bundle collisions: replacing them is an ordinary confirmation conflict.

For an agreed requirement:

1. If any selected bundle declares `dependencies`, use `dependencies`.
2. Otherwise use `devDependencies`.
3. Remove the same package from the other of these two sections, proposing confirmation when present. Do not touch optional/peer dependency sections.

This gives one deterministic location for same-version cross-section contributions. Deselection removes a package only from the section named by its current-known declaration, and only when no selected bundle requires that package. Migration dependency removals are also section-specific and yield to any selected requirement. Empty pre-existing sections remain as empty objects; deletion of an absent entry does not create an empty section.

## Migration and deselection

Only selected bundles' explicit `migration` declarations apply. The planner also has an explicit list of competing Oxc filenames: `.oxfmtrc.jsonc`, `.oxlintrc.jsonc`, and `oxfmt.config.*`/`oxlint.config.*` for `ts`, `mts`, `cts`, `js`, `mjs`, `cjs`. These are replacement/removal candidates, **not a claim that every name auto-discovers in every release**. Executable files are read only as bytes, never imported or executed. No filename search, shell parsing, or inference finds other legacy setup.

A selected output cannot also be a migration removal. Non-Oxc native files are treated as dedicated artifacts: identical contributions share a destination; different bytes or executable flags at the same destination fail with both source identities instead of guessing a merge. Existing dedicated content is replaceable with confirmation, except automation destinations which require an ownership marker. A deselected bundle's currently described dedicated file is removed with confirmation unless a selected bundle still supplies it. Edited dedicated content remains a removal candidate; automation uses the preservation rules below.

Renamed/disappeared files, scripts, dependencies, and retired bundles may remain for manual cleanup. There is no attempt to infer historical ownership or reconstruct vanished policy.

## Script and automation seams

Resolve the target manager with [`resolveTargetManager`](package-managers.md#resolve-before-planning) before planning; a question result must receive an explicit answer rather than a default. Its resolved `target.scripts` is `createScriptPlanner(targetManager)` from `src/scripts.ts`, passed through `PlanOptions.scripts(context)`. The adapter returns an Effect containing the complete scripts map. The context exposes the ordinary manifest after dependency planning, ordered selected bundles, and identifiable deselected bundles. The adapter owns composition, exact wrapper recognition, preserving unrelated commands, and typed conflicts; see the [script contract and shell support matrix](scripts.md). Its result becomes part of the same exact manifest change plan. Without this adapter, declared selected/deselected scripts are listed in `deferred`, existing scripts remain untouched, and `complete` is false.

Native files and removals under `.husky/` and `.github/workflows/` use built-in [automation preservation](automation.md). Dedicated files require an explicit native ownership comment; unrelated content is a hard planning conflict. The shared pre-commit hook uses one marked invocation block and a separate policy-authored file. Automation observations and exact operations belong to this same snapshot, confirmation, and complete plan; no application-time merge or automation execution occurs.

## Target safety and verification

`readTargetSnapshot(projectRoot, paths)` is also public for application adapters. Paths must be safe portable target-relative paths under the loader's rules. Case aliases (including parent-directory aliases), file/parent destination collisions, symlinks at the target root/traversed parent/leaf, and nonregular leaf files fail. Missing parent directories imply absent files, not permission to traverse links later. The target root's ancestors are trusted local paths; these checks do not sandbox an adversarial concurrent filesystem. Application must repeat appropriate path checks when writing.

`npm test` exercises the public planner with real temporary packages and native policies: deterministic ordering, fresh/existing targets, atomic rule tuples, overrides, native references, explicit migration with execution sentinels, dependency collisions/placement, shared deselection, exact-byte reruns, stale observations, malformed manifests, path/symlink failures, and deferred adapters. `npm run typecheck` checks the Effect contracts. Tests do not establish application, dependency installation, real package-manager compatibility, tool-version compatibility, UI, or distribution behavior. The separate [script tests](scripts.md#verified-environment-and-limits) establish composition on Linux `/bin/sh` with fake local runners, not other shells or platforms.
