# Set up and maintain a package

## Before setup

Use Bun 1.4.0 for the installer runtime and the GitHub launch command in the [quickstart](../README.md#quickstart), or run from a checkout with its dependencies installed. The supplied target policy requires Node 24+ for its commands; npm, pnpm, and Yarn also run on Node. Make the target manager available on `PATH` and check its [required version and settings](package-managers.md#supported-environments).

Inspect or save your target's current configuration, scripts, and dependencies before applying changes. Setup installs dependencies with lifecycle scripts enabled, including existing project scripts. It is not a sandbox or a transactional installer.

Run from the single package root you want to change:

```sh
cd /path/to/target-package
npx --yes 'ItsEthanDev/its-checks'
```

Only that directory's `package.json` is targeted; setup does not search workspaces. Both stdin and stdout must be terminals. Arguments, unattended flags, and piped input/output are not supported. Policy comes from the executed package or checkout's `policy/`, not the target directory. Default-branch launches may reuse cached code/policy; see [launch options and optional commit pinning](distribution.md).

## Choose and review

1. Select integrations and automation with Space, then Enter. Baseline TypeScript policy always applies. Integrations are explicit choices, not inferred from dependencies.
2. Answer any declared inputs. Tailwind asks twice for the same target-relative stylesheet path, once per tool. Both default to `src/styles.css`; use a stylesheet importing `tailwindcss`. The input need not exist during setup, but must exist when the tools use it.
3. If package-manager evidence is missing or conflicting, choose the target manager. Setup preserves other lockfiles and declarations; fix conflicting evidence yourself to avoid repeated questions.
4. Review changed files, package entries, and expected dependency work. Setup checks the manager environment before any writes. Replacements and removals require one confirmation, defaulting to No. Creation-only additions and matching plans do not ask this conflict question.

Declining leaves the package unchanged. Ctrl+C at a question exits 130 without writes or installation; failures exit 1. Changes to the target after planning stop application rather than silently applying a stale plan. Do not edit the package concurrently with setup.

Setup writes configuration and cleanup changes, then `.its-checks.json`, then reassesses dependencies and runs normal `<manager> install` if needed. Lifecycle scripts see the new configuration and intent. Installation can change lockfiles and have other lifecycle effects.

## Run project commands

| Command | Behavior |
| --- | --- |
| `node --run fmt` | Write formatting changes |
| `node --run fmt:check` | Check formatting |
| `node --run lint` | Lint; warnings fail |
| `node --run lint:fix` | Apply safe lint fixes; remaining diagnostics fail |
| `node --run check` | Check formatting, then lint; stop on failure |

Your manager's `run <name>` also works. Existing public commands run first, followed by policy contributions through reserved `its-checks:` helpers. A failed expression stops subsequent expressions. Commands require POSIX `/bin/sh`.

Baseline enables Oxlint `options.typeAware` and pins `oxlint-tsgolint` alongside Oxlint. This does not supply a project TypeScript typecheck command or give JavaScript plugin rules TypeScript type information.

Husky runs the entire package's `check` without fixing or staging files. GitHub Actions runs a locked install and `check`; it requires an exact supported `packageManager` declaration, a committed compatible lockfile, and the [required manager settings](package-managers.md#supported-environments). For example, npm uses `"packageManager": "npm@11.19.0"`. Keep the checkout's native workflow suitable for your repository; hosted execution is not guaranteed.

## Rerun or change selections

Rerun setup to change choices or apply policy from the executed package. For checkout edits, rerun the same source command; for GitHub updates, account for the [launcher's cache](distribution.md#default-branch-and-caching). Each run shows all choices and input questions. `.its-checks.json` prefills still-available selections and saved answers; answers take precedence over declaration defaults, including `false`, `0`, and empty strings.

The file records **intended setup**, not successful installation. Matching configuration does not suppress dependency assessment. A fully matching package has no writes or installation. Whitespace and object-key order in `package.json`, including Oxfmt's native package sorting, do not require installation. Matching manifest values retain their formatted bytes. Schema decoding is offline: setup does not fetch the saved schema or repository.

Deselecting proposes cleanup using prior selected IDs and their **current** bundle definitions. Selected requirements shared with another bundle remain. Deselected answers are dropped; reselecting later uses defaults again. Retired IDs are reported and dropped when saving, but their historical files, scripts, and dependencies cannot be reconstructed. Renamed or vanished policy entries can require manual cleanup. Keep prior intent while recovering; deleting it loses this cleanup information.

Generated Oxc configs replace existing target policy; existing rules are not merged in. To keep a customization across reruns, [edit the source policy](policy.md). Semantically matching Oxc JSON/JSONC retains its bytes and comments. Unrelated manifest values and unlisted files remain, but changed manifests are reserialized.

## Resolve conflicts

- **Ordinary replacements/removals:** inspect the plan, preserve anything needed, then approve or decline. Explicit migration removes only named legacy setup; executable configuration is read as bytes, never imported.
- **Unmarked native automation:** an existing dedicated hook/workflow without `# its-checks: managed` is a hard conflict. Move or rename it, or change the policy destination. Generic confirmation cannot overwrite it. Adding the marker yourself explicitly adopts the file. See [ownership rules](policy.md#native-automation).
- **Malformed shared hook block:** restore exactly one ordered whole-line `# BEGIN its-checks` / `# END its-checks` pair, or remove the delimiters manually before retrying. Keep unrelated commands.
- **Edited script wrapper:** if a public command references its helper but no longer matches the generated wrapper, restore it or remove that reference and rename/remove the helper, preserving commands you need. An orphaned `its-checks:` helper is a reserved-namespace collision, even if its bytes match policy. Edit declarations instead of generated wrappers.
- **Invalid saved intent:** fix the reported strict-JSON, provenance, or answer error. Only an absent `.its-checks.json` means first use; malformed state is not silently discarded. Save a copy before deliberate removal and inspect leftover setup manually.
- **Unsafe paths:** replace symlinks/nonregular target files with ordinary files or choose another target. Setup rejects unsafe traversal and case-alias destinations; ancestor directories remain trusted local paths.

## Recover from failure

1. Read the completed/incomplete operations and dependency status in the error report.
2. Inspect files, manifest, lockfiles, installed state, and lifecycle effects. Fix the underlying filesystem, environment, dependency, or script failure. There are no automatic backups or rollback; interrupted writes can be partial.
3. Rerun the CLI to build and approve a **fresh** plan. Configuration and saved intent may already match while dependency work remains. Do not replay an old plan or treat intent as proof of success.

Cleanup finishes before intent is updated, preserving normal deselection identity if filesystem work fails. Intent publication preserves complete old-or-new bytes, but the package as a whole is not atomic or power-loss durable. Abrupt termination can leave a temporary intent sibling; it is not history and normal setup does not read it.

Observed install failures invalidate bounded native inventory to trigger retries. Bun needs an eligible direct dependency link; external installs and abrupt lifecycle failures can leave apparently complete metadata. Follow the [manager-specific retry limits](package-managers.md#failure-and-retry) rather than assuming every failure is detectable.

When retiring Husky, inspect other hooks before manually changing `core.hooksPath` or removing `.husky/_`. Deselection removes its managed invocation and dedicated file, not those lifecycle effects. An empty shared `.husky/pre-commit` may remain.

## Known limitations

- Policy validation checks structure, not runtime tool compatibility. Exercise the generated commands with your selected rules and dependencies. Convex integration and hosted Actions execution remain unverified; manager support alone does not establish native package or plugin compatibility.
- Tailwind policy targets v4, not v3. Oxlint's JavaScript plugin API is alpha; plugin loading does not guarantee every rule or parser works. JavaScript plugin rules still lack TypeScript type information, even with native type-aware lint enabled. Review transitive plugin dependencies and advisories when installing.
- Other platforms, shells, manager versions, and workspace configurations are outside the [supported environment scope](package-managers.md#supported-environments).
