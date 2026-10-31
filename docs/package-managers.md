# Target-project package managers

`src/package-managers.ts` resolves the target manager, supplies its script planner, and implements `ApplicationDependencies`. It does not choose a launch/distribution manager, change dependency requirements, persist success state, or present prompts.

## Resolve before planning

```ts
const resolution = yield* resolveTargetManager(projectRoot);
// Present a question when resolution.kind === "question"; do not mutate or default.
// Feed the explicit answer back to resolveTargetManager(projectRoot, answer).
if (resolution.kind === "resolved") {
  const target = resolution.target;
  const plan = yield* planProject(projectRoot, resolvedPolicy, {
    scripts: target.scripts,
  });
  const dependencies = createDependencyAdapter(target);
  const dependencyPreview = yield* dependencies.assess(plan); // optional, read-only
  // Present this exact plan and obtain approval before applyPlan.
  const report = yield* applyPlan(plan, { approved: true, dependencies });
}
```

`resolveTargetManager` reads the current directory's `package.json`, `packageManager`, and lockfile presence. npm evidence includes `package-lock.json` and `npm-shrinkwrap.json`; pnpm uses `pnpm-lock.yaml`; Yarn uses `yarn.lock`; Bun uses `bun.lock` or legacy `bun.lockb`. Multiple files for the same manager identify that manager. Missing evidence, unknown/malformed declarations, different-manager lockfiles, and declaration/lock disagreement return a `question` with evidence and all four choices. A declaration does not silently override conflicting locks. An explicit answer selects the manager; other declarations/lockfiles remain untouched. A subsequent invocation can therefore ask again until the project resolves its evidence.

Resolution identifies a manager, not compatibility. The adapter checks the actual executable version and rejects an unsupported same-manager declaration before launching it. Integrity suffixes on an otherwise exact `packageManager` version are accepted. No semver compatibility range is asserted. A declaration for a different manager can remain after an explicit answer; the chosen manager's executable must still match the tested version.

## Tested environments

All real checks ran on Linux x64, Node **24.21.0**, POSIX `/bin/sh`, normal lifecycle execution, development dependencies enabled, and isolated temporary packages. Windows, macOS, custom script shells, production-only installs, Yarn Berry, PnP, and other versions are not claimed.

| Target | Exact version | Required environment | Runner |
| --- | --- | --- | --- |
| npm | 11.19.0 | npm lock v3 and regular `node_modules` | `npm run its-checks:<name>` |
| pnpm | 12.9.0 | Default isolated linker; project `.npmrc` contains `manage-package-manager-versions=false` | `pnpm run its-checks:<name>` |
| Yarn Classic | 1.22.22 | Default `node_modules`; no PnP | `yarn run its-checks:<name>` |
| Bun | 1.4.0 | Text `bun.lock`; explicit `[install]` / `linker = "isolated"` in `bunfig.toml` | `bun run its-checks:<name>` |

The adapter rejects missing required pnpm/Bun configuration instead of changing a project's linker or CLI-management policy. pnpm's CLI-management feature can download a CLI and write extra lockfile documents even during inspection; disabling it is necessary for the read-only seam. Native multi-document pnpm locks are parsed without treating the CLI-management document as the package importer. npm/pnpm/Yarn `config get ignore-scripts` must not report `true`.

Yarn Classic is a repo-local development dependency so `npm run test:managers` has a Yarn binary without a system installation. Its preinstall script only handles global Corepack symlinks; it was inspected and installation used `--ignore-scripts`. Yarn 4.14.0 was probed but is **not supported**: its portable shell did not execute the existing multiline POSIX wrappers correctly, and normal Yarn 4 installation did not execute root `prepare`. No policy workaround or Yarn 4 compatibility claim is included.

The real suite uses pinned local `.tgz` fixtures without package scripts, remote dependencies, or binaries. This establishes direct dependency installation/reconciliation, not Oxc/Tailwind/native package compatibility (#11). Registry authentication, workspaces, peer/optional/platform dependency combinations, aliases, git/linked-directory dependencies, changed-in-place local archives, and manager plugin/config overrides are not established by these checks. Use immutable local archive paths for updates. Bun local archive assessment also requires POSIX `tar` to read `package/package.json` without extracting or executing it.

## Assessment and exact-manifest installation

`assess(plan)` returns `required` or `not-required` without installation. Before application, differences between disk and the approved manifest imply work. After configuration is written, application **always reassesses**; a preview is not cached authorization or proof of success. Saved selections never control dependency necessity.

Assessment compares the exact approved manifest to disk, then checks native state:

- npm: root lock requirements, installed hidden-lock entries, and locked installed package versions; platform-omitted optional entries can be absent.
- pnpm: importer requirements, equality of the package lock document and virtual-store lock, native modules metadata, and direct installed versions.
- Yarn Classic: top-level integrity patterns, lock resolutions against native integrity entries, and direct installed versions.
- Bun: workspace requirements, lock resolutions, installed direct versions, and direct links into the project's `.bun` store. Local archives additionally check archive integrity and the installed store location against the requested archive.

Native metadata missing, missing packages, wrong versions, stale resolutions, or mismatched locks request work. Pending approved configuration changes with root lifecycle scripts also request installation. npm/pnpm/Yarn additionally compare manifest freshness with native install metadata. These are state/inventory checks, not cryptographic verification of every installed file or proof that intact native metadata cannot hide transitive/content corruption.

`install(plan)` refuses a disk manifest differing from the approved bytes, runs normal `<manager> install` with no script-suppressing or add/remove/version-selection flags, verifies the manifest stayed exact, and assesses the resulting state. An exit-zero subprocess with mismatched installed state is a failure. Native managers resolve the literal planned requirements; the adapter implements no version resolver. Lifecycle commands see the already-written configuration and intended selections. Existing project scripts and unrelated dependencies remain in the approved manifest.

Before a required npm/pnpm/Yarn installation, the adapter invalidates their disposable native inventory, forcing missing links to be reconciled rather than trusting a stale fast path. It never does this on a matching no-op. Bun 1.4 leaves some obsolete direct links after normal installation; the adapter unlinks only a dependency explicitly removed by the approved package entries, absent from every remaining dependency section, and pointing into the target's `.bun` store. Store package contents are not deleted.

## Failure and retry limits

Normal install is not transactional. The adapter returns `OperationError` through the common [application report](application.md), preserving subprocess diagnostics and stating that configuration, saved intent, lockfile changes, and lifecycle effects remain. It never describes partial work as success or rollback.

On an **observed adapter installation failure**, retry evidence is invalidated using existing installation artifacts only:

| Manager | Invalidated artifact | Why normal installation recreates it |
| --- | --- | --- |
| npm | `node_modules/.package-lock.json` | Disposable hidden inventory of installed packages |
| pnpm | `node_modules/.modules.yaml` and `node_modules/.pnpm-workspace-state-v1.json` | Modules layout inventory and fast-path workspace validation cache |
| Yarn Classic | `node_modules/.yarn-integrity` | Installed-tree integrity inventory |
| Bun isolated | One direct dependency symlink named by the approved manifest, verified to point inside target `node_modules/.bun` | Missing direct dependency is relinked from the retained store |

No authored lockfile, manifest, dependency package directory, symlink target, historical ownership file, or new success marker is deleted/created for recovery. Nonregular native metadata is not removed. Invalidation failure reports both the original installation failure and the invalidation problem, explicitly saying retry is not guaranteed.

**Bun recovery is blocked when no approved direct dependency symlink into its store exists**, including dependency-free late lifecycle failures or a hoisted installation. The adapter reports this rather than deleting broader content. The verified Bun failure/retry case retains direct dependencies. This limitation is not a guarantee of recovery for every Bun project.

Native artifacts alone cannot prove that an arbitrary root lifecycle script completed. npm can write lock/inventory state before root lifecycle execution. External installs, abrupt termination before invalidation, and independently edited lifecycle/configuration without corresponding native evidence can therefore leave an indistinguishable state. Those cases are **not established recovery guarantees**; inspect/fix the lifecycle failure and invalidate native install inventory or the affected installed dependency before rerunning. There is deliberately no persistent installer success/history file. Filesystem checks are not a concurrency lock or a sandbox for untrusted lifecycle scripts.

## Verification commands

```sh
npm test
npm run typecheck
npm run test:managers
```

The ordinary suite tests manager questions and application behavior through `ManagerOperations.run(command, args, cwd)`, substituting only external processes. It checks exact approved manifests, configuration-before-install, matching no-op, actual version drift, late failures and retries, exit-zero false success, process errors, disabled lifecycle/environment errors, and invalidation failure. The shared fixture's `install: exit 99` is preserved but never executed.

`test/real-managers.integration.ts` is separate from `npm test`. All four prerequisites are mandatory: an absent/wrong manager fails the suite instead of silently skipping. The documented command prepends repo-local Yarn through npm's normal script PATH. Four real-manager cases perform six installations each (24 total), including one intentional root `postinstall` failure per manager. They verify additions, archive/version updates, explicit removals, unrelated dependency preservation, config-first lifecycle execution, stale locks, missing-link repair, failure with dependencies/locks already present, retained intent/configuration, successful retry, repeated zero-install no-ops, and actual generated public/helper wrappers. All fixture scripts are visible at the top of the test and perform only local Node filesystem operations; archives contain only an inspected manifest with no scripts. A temporary local tar archive is a dependency fixture, not a distribution/publishing experiment. Set `ITS_CHECKS_KEEP_FIXTURES=1` only for local diagnosis when retaining temporary test directories is desired.
