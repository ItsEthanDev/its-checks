# Target package managers

Install the target manager yourself and make its exact executable available on `PATH`. Bun 1.4.0 installs checkout dependencies and runs the installer; it does not select or replace the target manager.

## Supported environments

The adapter's tested environment is Linux x64 with the installer running on Bun **1.4.0**, target Node **24.21.0**, POSIX `/bin/sh`, normal target lifecycle execution, and development dependencies enabled. The supplied target policy still uses Node commands, even for Bun-managed targets.

| Manager | Exact version | Required target environment |
| --- | --- | --- |
| npm | 11.19.0 | Lockfile v3 and regular `node_modules` |
| pnpm | 12.9.0 | Default isolated linker; project `.npmrc` setting below |
| Yarn Classic | 1.22.22 | Default `node_modules`; no PnP |
| Bun | 1.4.0 | Text `bun.lock`; explicit isolated linker setting below |

For pnpm, put this in the target's `.npmrc`:

```ini
manage-package-manager-versions=false
```

This prevents CLI management from downloading a CLI or changing lock state during read-only assessment. Setup rejects a missing setting instead of changing it.

For Bun, put this in the target's `bunfig.toml`:

```toml
[install]
linker = "isolated"
```

Setup rejects a missing setting or a hoisted environment. Bun local archive assessment also needs POSIX `tar` to read the archive's package manifest.

npm, pnpm, and Yarn must not report `true` for `config get ignore-scripts`. Setup runs normal installation without script suppression. Generated helpers use `<manager> run its-checks:<name>`; keep commands compatible with POSIX `/bin/sh`.

Other versions, Windows, macOS, custom script shells, production-only installs, Yarn Berry/PnP, and manager plugin/config overrides are not supported claims. Workspace behavior, registry authentication, general peer/optional/platform dependency combinations, aliases, Git/linked-directory dependencies, and changed-in-place local archives are not established. Use immutable local archive paths for updates. The manager matrix establishes adapter reconciliation and lifecycle behavior, not the current whole Oxc/plugin policy graph's compatibility on each manager.

## Select the manager

Setup reads the target's `packageManager` and these lockfiles:

| Manager | Evidence |
| --- | --- |
| npm | `package-lock.json`, `npm-shrinkwrap.json` |
| pnpm | `pnpm-lock.yaml` |
| Yarn | `yarn.lock` |
| Bun | `bun.lock`, legacy `bun.lockb` |

Legacy Bun lock presence identifies the manager; it does not establish a supported installed environment. Missing evidence, malformed declarations, or disagreement asks you to choose. A declaration does not override conflicting locks. Your answer leaves existing declarations/lockfiles untouched, so ambiguity can recur.

The actual executable must match the table. Same-manager declarations must use the exact version, for example `npm@11.19.0`; integrity suffixes are accepted, ranges are not. An explicit choice can leave a different-manager declaration, but does not waive executable/environment checks. The [Actions workflow](../policy/typescript/automation/github-actions/files/.github/workflows/its-checks.yml) additionally requires an exact supported declaration and committed compatible lockfile.

## Installation and no-op behavior

Setup checks the environment before writing. Dependency assessment compares semantic requirements, lock requirements/resolutions, native inventory, direct installed versions, and manager-specific store/link state. JSON whitespace, object-key order, and manifest mtime alone do not request installation. Missing packages, stale locks, or missing inventory still request installation even if configuration matches. Native metadata is not a cryptographic check of every installed file.

Dependency removal deletes the declared direct requirement, not every installed copy. npm and Yarn may keep a hoisted package when another package's native lock entry still references it as a dependency or peer. That incidental installation is accepted only alongside matching native lock/inventory and the adapter's installed-version checks. pnpm and Bun's isolated layouts may keep the incidental copy separately while removing the old direct link. Unreferenced obsolete root packages still request reconciliation.

Plan changes to root lifecycle commands or their generated `its-checks:` helpers request installation. With a lifecycle command present, planned changes to configuration files also request installation so that lifecycle execution sees the new configuration. Unrelated manifest fields and non-lifecycle scripts alone do not request it.

When needed, setup runs normal `<manager> install`, requires the manifest to remain exactly approved, and checks resulting installed state. Semantic assessment does not weaken application safeguards: any target byte or mode change since approval still requires a fresh plan. A zero exit status with mismatched state is still a failure. Requirements are passed literally to the manager, not independently resolved by setup. A matching package has no installation or inventory invalidation.

## Failure and retry

Installation is not transactional. Configuration, intent, lockfile changes, and lifecycle effects remain after failure. Inspect and fix the cause, then [rerun from a fresh plan](usage.md#recover-from-failure).

On an observed installation failure, setup invalidates only these disposable artifacts to make work visible on retry:

| Manager | Retry artifact |
| --- | --- |
| npm | `node_modules/.package-lock.json` |
| pnpm | `node_modules/.modules.yaml` and `node_modules/.pnpm-workspace-state-v1.json` |
| Yarn Classic | `node_modules/.yarn-integrity` |
| Bun isolated | One approved direct dependency symlink verified to point into the target's `node_modules/.bun` store |

npm/pnpm/Yarn also invalidate their inventory before a required install to avoid stale fast paths. Nonregular metadata is not removed. Bun reconciles obsolete direct store links only for explicitly approved removed dependencies absent from remaining dependency sections, even after a failed install if the manifest still matches. Store contents and unrelated links remain.

**Bun retry is not guaranteed without an eligible approved direct dependency link**, including dependency-free late lifecycle failures. An invalidation failure is reported alongside the original failure. Setup does not delete broader dependency trees or authored lockfiles for recovery.

Native inventory cannot prove arbitrary root lifecycle completion or record which command bytes last ran. Lifecycle/configuration edits made before planning, changes inside delegated scripts, external installs, and abrupt termination before invalidation can leave apparently complete installed state. A no-op assessment establishes matching dependency state, not that these lifecycle effects completed. Manifest mtime cannot resolve this ambiguity: formatters change it too.

If lifecycle execution is needed independently of a plan change, inspect the commands and run the target manager's normal install yourself, checking its result, or invalidate the relevant native inventory/eligible Bun dependency link before rerunning setup. Automatic recovery is not guaranteed. No persistent success marker or installation history is stored.
