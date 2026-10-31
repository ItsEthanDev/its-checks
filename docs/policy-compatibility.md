# Released policy compatibility

## Verified set

Checked 2026-10-31 on Linux x64, Node **24.21.0**, npm **11.19.0**, POSIX `/bin/sh`, regular `node_modules`, and normal root lifecycle execution.

| Package | Exact shipped version | Established behavior |
| --- | --- | --- |
| Oxfmt | 0.75.0 | Native TypeScript/TSX formatting, import sorting, Tailwind v4 stylesheet/class sorting |
| Oxlint | 1.90.0 | TypeScript correctness rules, JS plugin loading, plugin errors and automatic fixes |
| Tailwind CSS | 4.3.3 | CSS-first stylesheet import and custom `@theme` with Oxfmt and lint plugin |
| eslint-plugin-tailwindcss | 4.4.0 | `no-contradicting-classname` reports conflicting display classes; `important-modifier-suffix` reports and fixes `!font-bold` |
| Husky | 9.1.7 | Root postinstall configures local dispatch; actual pre-commit dispatch passes clean code and rejects bad code |

**Only this Tailwind v4 combination is supported by shipped policy.** Tailwind v3 is not selected or tested. There is no Effect integration and no ESLint fallback. npm installs ESLint as the plugin's peer, but generated commands exclusively run Oxlint. The plugin's published package is 4.4.0 even though its internal `plugin.meta.version` string says `4.4.0-beta.0`; compatibility assertions use its package manifest and actual rule behavior, not that stale internal string.

Oxlint's JS-plugin API is alpha. This is evidence for the two enabled rules on TS/TSX, not a blanket claim that every plugin rule, parser, JSX framework, or future package version works. The supplied examples are lint/format targets, not applications or JSX typecheck/build fixtures. Baseline checks are not type-aware; no TypeScript typechecking command or parser service is implied.

## Repeat the evidence

From the repository root with its development dependencies present:

```sh
npm test
npm run typecheck
npm run test:policy
```

`test/policy.test.ts` uses real shipped files through discovery, input resolution, planning, and application, substituting only dependency operations. It verifies preservation, explicit config migration without execution, no-op reruns, deselection, and policy-only changes to baseline/integration, script/dependency declarations, native automation commands, and discovery/application of a new integration directory. Agent-authored changes exercise the seam; they do not attest owner acceptance.

`test/policy-compatibility.integration.ts` copies `examples/typescript`, then adds `examples/tailwind` sources and selects all shipped bundles through the real loader/planner/application and **normal npm dependency adapter**. It checks:

- Exact installed package versions; baseline formatting/lint failures and fixes; successful common commands.
- Oxfmt transforms `p-4 flex bg-brand font-bold!` into `flex bg-brand p-4 font-bold!` using a stylesheet with a custom brand color.
- Oxlint loads the actual candidate plugin, reports contradictions, and fixes the important suffix; no ESLint CLI runs.
- Original postinstall/hook commands survive; Husky sets local `core.hooksPath`; its real dispatcher runs `node --run check`, passes clean code, and rejects a debugger fixture. No commit occurs.
- Exactly two normal adapter installs (baseline, then full setup); matching reruns require no writes or installs; one hook invocation block remains.

Before either normal install, the suite resolves the exact approved manifest into an isolated **scripts-disabled audit tree**, reads every installed package's lifecycle declarations, rejects newly introduced preinstall/install/postinstall hooks or implicit `binding.gyp` installs, and reuses the audited lock graph. The observed graphs contained 5 baseline and 123 full installed manifests. Optional packages for other platforms are not installed or executed. Registry dependencies' prepare/build/test/release declarations are not installation hooks; they are not invoked. Root fixture scripts only append a local sentinel and invoke the inspected Husky binary. Husky writes local Git config and `.husky/_` dispatch files; its `init` command, which rewrites scripts/hooks, is never used. The hook test isolates HOME/XDG configuration to avoid personal init scripts. Temporary projects and audit trees are removed by default; set `ITS_CHECKS_KEEP_FIXTURES=1` only for local diagnosis.

Normal npm install reported **7 moderate advisories**, no high/critical advisories, in the candidate plugin's ESLint dependency graph. `npm audit --prefix /tmp/its-checks-policy-audit --json` during implementation traced them to [minimatch globparts amplification, GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (`minimatch <11.0.1`). This snapshot can change as transitive ranges resolve; no automatic audit fix or unverified override was applied. Treat dependency review and untrusted lint input as continuing risks.

## Policy decisions exposed by real execution

- Explicitly ignore `**/node_modules/**` in Oxlint. With this released version/config, omitting that ignore caused `oxlint .` to lint installed dependencies.
- Disable Oxfmt package-key sorting: sorting rewrote the planned manifest and triggered the adapter's documented lifecycle freshness assessment on rerun. Keep generated intent JSON outside formatting, because compacted selection arrays otherwise produced confirmation churn.
- Author workflow bytes already formatted by the prescribed Oxfmt; formatting then rerunning must not repeatedly replace them.
- Use `node --run` for manager-neutral project command invocation. The generated reserved-helper runners still use the actual target manager. Use root `postinstall: husky` rather than relying on `prepare` across managers.
- Both tools need the same v4 stylesheet. The existing one-destination input contract exposes two explicit path questions; no Tailwind-specific binding logic was added to the installer.

## Coverage boundaries and remaining gates

The real shipped-policy suite covers **npm only**. [Separate real adapter tests](package-managers.md) cover npm 11.19.0, pnpm 12.9.0, Yarn Classic 1.22.22, and Bun 1.4.0 with local dependency fixtures and lifecycle/wrapper execution. They do not establish this native Oxc/plugin dependency graph on pnpm/Yarn/Bun. `node --run` and policy commands are manager-neutral; full policy-specific peer/native-package behavior on those managers remains unverified. Do not infer Yarn Berry, Windows, macOS, workspaces, or other version support.

The Actions file is native YAML loaded/composed/preserved and formatted locally, **not a remotely executed workflow**. It requires an exact supported `packageManager`, a committed compatible lockfile, and the existing manager prerequisites (including pnpm `.npmrc` and Bun isolated linker). It selects the declared manager and runs a locked installation followed by `node --run check`; `HUSKY=0` avoids CI hook setup. GitHub action versions/runners and remote CI success remain unverified. No Actions, deployment, push, publication, or packaging experiment was run.

The schema pin was checked with `git show 85e709004b65df77a1fa13ac8f7c119784c82602:schemas/selections.schema.json`. That proves local content only; no remote schema resolution is claimed. [Owner acceptance](owner-acceptance.md) remains pending. The application recovery correction in `0b2c70f` preserves prior deselection intent until cleanup finishes; integrated failure/replan regression checks pass. It is independent of the policy compatibility evidence.

## First-party evidence

Version metadata was checked with `npm view <package>@<version>` and the installed published manifests/APIs, then exercised as above. These are released-package observations, unlike the earlier [source-only Oxc research](research/oxc-configuration.md).

- [Oxfmt sorting](https://oxc.rs/docs/guide/usage/formatter/sorting): `sortTailwindcss.stylesheet` for v4, target-config-relative paths, explicit function names.
- [Released Oxfmt 0.75.0 schema](https://github.com/oxc-project/oxc/blob/oxfmt_v0.75.0/npm/oxfmt/configuration_schema.json) and installed `oxfmt/configuration_schema.json`: shipped native option shapes.
- [Oxlint JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins) and [released Oxlint 1.90.0 schema](https://github.com/oxc-project/oxc/blob/oxlint_v1.90.0/npm/oxlint/configuration_schema.json): `jsPlugins`, rules/settings, alpha API limits.
- [Plugin v4.4.0 README](https://github.com/francoismassart/eslint-plugin-tailwindcss/blob/v4.4.0/README.md), installed `lib/index.cjs`/worker and package manifest: v4-only scope, mandatory `cssConfigPath`, rule names, peer requirements and implementation. Upstream documentation prescribes ESLint; its Oxlint compatibility is established here by execution, not by assuming upstream endorsement.
- [Tailwind CSS theme variables](https://tailwindcss.com/docs/theme) and published `tailwindcss@4.3.3` API consumed by both tools.
- [Husky get started](https://typicode.github.io/husky/get-started.html) and [9.1.7 implementation](https://github.com/typicode/husky/blob/v9.1.7/index.js): inspected bin/index/dispatcher behavior.
- [Node 24 `--run`](https://nodejs.org/docs/latest-v24.x/api/cli.html#--run): local project scripts and `node_modules/.bin` PATH, without manager-specific command spelling.
- First-party action declarations inspected for authored workflow inputs: [setup-node v4](https://github.com/actions/setup-node/blob/v4/action.yml), [pnpm/action-setup v4](https://github.com/pnpm/action-setup/blob/v4/action.yml), and [setup-bun v2](https://github.com/oven-sh/setup-bun/blob/v2/action.yml). Input/source inspection does not establish hosted execution.
