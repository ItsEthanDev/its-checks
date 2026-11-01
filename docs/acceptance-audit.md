# Technical acceptance audit: issue #1

Audit date: 2026-10-31 UTC. Audited source: `aec07d3a28939bb76229d5c97ad7f11a734d3cb5`, matching GitHub `main` when checked. This hash identifies the audited snapshot, not a prescribed launch revision.

Follow-up: A2 is resolved by the simplified saved-intent format and [`intent.schema.json`](../schemas/intent.schema.json). The schema/source duplication is removed; `commit` now describes reliable local execution identity or is omitted. The audit results below describe the original snapshot. A1 remains unchanged.

## Conclusion

All 28 acceptance entries in [#1](https://github.com/ItsEthanDev/its-checks/issues/1) are accounted for within the documented Linux/POSIX, single-package support scope. No new functional failure was reproduced. All acceptance suites passed, including fresh real-manager, live-policy, packaged-CLI, and GitHub source-launch checks.

There are two findings before final acceptance:

1. **Risk decision:** the Tailwind tooling graph still has one moderate `minimatch` advisory affecting seven packages. The installer checkout's locked dependency audit is clean. Exploit reachability in the configured tools was not established; the advisory must not be described as harmless or resolved.
2. **Documentation inconsistency:** the saved-intent schema's descriptions still imply that `source.revision` identifies the executing policy, although the implemented and documented contract pins the schema revision. Runtime behavior and remote schema availability are correct under the selected contract.

The owner's independent baseline/integration editing test has already been reported complete and explicitly approved. It does not need repeating. Final product acceptance, the advisory decision, and disposition of the wording finding remain with the owner. This audit does not close #1 or edit its checkboxes.

## Fresh verification

Environment: Linux x86_64; Bun 1.4.0; Node 24.21.0; npm/npx 11.19.0; pnpm 12.9.0; Yarn Classic 1.22.22; Git 2.55.0; POSIX shell. Effect 4.1.1 and Clack 1.8.1 were confirmed installed.

| Check | Result and evidence |
| --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | Passed; no dependency changes |
| `bun run test` | Passed: 138 unit/feature cases |
| `bun run typecheck` | Passed |
| `bun run test:managers` | Passed: 9 real-manager cases; includes all four adapters, incidental dependency retention, five intentional lifecycle failures, and recovery/removal regressions |
| `bun run test:policy` | Passed: fixed reference baseline + Tailwind + automation; real Oxfmt/Oxlint commands and Husky pass/fail; 5 baseline and 123 combined dependency manifests inspected before normal lifecycle execution |
| `bun run test:cli` | Passed: 6 real terminal cases |
| `bun run test:package` | Passed: actual archive contents and isolated production-only installation, exercising all 6 terminal cases through the installed bin |
| One-off current live-policy compatibility run | Passed: baseline + Tailwind + Husky/Actions materialization; 7 baseline and 125 combined dependency manifests inspected; two normal npm installs; formatter/setup convergence and matching reruns verified |
| One-off real GitHub source-package smoke | Passed: default and commit-pinned npm/npx and Bunx commands; configuration before authored lifecycle execution; formatting/check commands; exact no-op reruns after native manifest formatting; noninteractive refusal without writes |
| Generated schema URL | HTTP 200; published bytes match the local schema and the pinned schema-containing commit |
| `bun audit --json` | Exit 0, `{}`: no advisories reported for the checkout's Bun lockfile |
| `npm audit --json` on reference and live Tailwind graphs | Exit 1: seven moderate affected packages, one underlying advisory; see A1 |

Maintained behavioral tests use fixed or temporary policy. The packaging test compares shipped files to their authored bytes without prescribing editable policy opinions. Live-policy checks were temporary observations, not new assertions against root policy.

Session evidence is under `/tmp/its-checks-acceptance-audit-OsSZXB/`: suite logs, source-launch observations, and advisory JSON. Temporary installation trees and their caches were removed after capture. The maintained suites and the matrix below are the durable reproduction path. `bun pm scan` was unavailable without a configured scanner; the built-in `bun audit --json` supplied the checkout audit instead. No scanner or dependency was added.

## Acceptance matrix

“Pass” is bounded by the environment and limits below. Inspection evidence is identified rather than presented as runtime integration coverage. Row numbers follow the original #1 acceptance list.

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | TypeScript, idiomatic Effect v4, Clack | Pass | [Workflow](../src/workflow.ts) uses Effect sequencing and typed failures; [loading](../src/bundle-loading.ts), [inputs](../src/inputs.ts), and [intent](../src/selections.ts) use Schema decoding; [application](../src/application.ts) and [snapshots](../src/target-snapshot.ts) manage handles with `acquireUseRelease`; [presentation](../src/presentation.ts) uses standard Clack prompts. Typecheck and terminal suites pass. |
| 2 | One target package; clear noninteractive failure | Pass | [CLI](../src/cli.ts) passes `process.cwd()`; no workspace traversal. [Workflow tests](../test/workflow.test.ts) and [PTY cases](../test/cli.pty.py) verify early refusal without target reads/writes. |
| 3 | Explicit choices on every run, with preselection | Pass | `setup` always invokes both categories. Workflow and PTY first-run/rerun cases verify preselection and input prefills rather than silently skipping questions. |
| 4 | Standalone Oxc configuration for new/existing projects | Pass | [Composition](../src/composition.ts) materializes both configs; [planning](../test/planning.test.ts) and [application](../test/application.test.ts) cover creation/replacement. Real policy runs execute the generated tools without requiring an installer runtime in the target. |
| 5 | Verified Tailwind formatting and linting | Pass | [Compatibility suite](../test/policy-compatibility.integration.ts) and the live-policy run verify Oxfmt 0.75.0, Oxlint 1.90.0, Tailwind 4.3.3, plugin 4.4.0, sorting, contradictory classes, important suffix fixes, and combined checks. Security finding A1 remains separate. |
| 6 | Validate policy and complete the plan before mutation | Pass | [Loader](../src/bundle-loading.ts), [input resolution](../src/inputs.ts), and [planner](../src/planning.ts) precede application. Bundle/input/workflow tests assert invalid data leaves the target unchanged; incomplete plans are rejected. |
| 7 | One conflict confirmation; decline changes nothing | Pass | `requiresConfirmation` is plan-level; [workflow tests](../test/workflow.test.ts) count one question for combined conflicts/removals. Application and PTY cases prove decline is read-only. |
| 8 | Reapply dedicated configuration; preserve unrelated shared content | Pass | Planning replaces, rather than inherits, existing Oxc rules. Application and automation suites preserve unrelated manifest fields, hooks, and workflows. |
| 9 | Deselect current-known setup without historical ownership | Pass, limited | Planning/automation/script tests preserve shared requirements and remove identifiable deselections. Retired/renamed policy requires manual cleanup and is disclosed by workflow tests; no historical inventory is introduced. |
| 10 | Explicit migrations; never evaluate existing executable configs | Pass | [Planning migration case](../test/planning.test.ts) includes executable sentinels that remain unexecuted. Only named files/sections and explicit competing config candidates are removed; unlisted legacy setup remains. |
| 11 | Matching reruns: no writes, installs, or conflict question | Pass | Application, workflow, PTY, packaged CLI, all real adapters, compatibility, and fresh GitHub runs verify matching reruns. Formatting/key-order/mtime regressions and repeated format/setup cycles are retained. |
| 12 | Configuration/intent before install; accurate failure/retry | Pass, limited | [Application](../src/application.ts) finishes config/cleanup, publishes intent, then assesses/installs. Failure suites cover partial writes and retained intent. Real adapters exercise late lifecycle failures and retry. Bun/abrupt-termination limits are explicit below. |
| 13 | Behavioral npm/pnpm/Yarn/Bun target operations | Pass, tested matrix | [Adapter tests](../test/package-managers.test.ts), [environment checks](../test/manager-environments.test.ts), and [real managers](../test/real-managers.integration.ts) cover ambiguity, actual state, additions/updates/removals, incidental copies, no-ops, stale state, failure/retry, and normal script execution. |
| 14 | One intent file with schema/source, answers, no history/network decoding | Pass; wording finding A2 | [Selections](../src/selections.ts), [schema](../schemas/selections.schema.json), and [input tests](../test/inputs.test.ts) cover strict shape, provenance consistency, bogus/unpublished fixture URLs, and saved answers. Published schema availability was verified separately, not added to runtime decoding. |
| 15 | Inputs from every bundle category; bind before composition; prefill | Pass | [Input tests](../test/inputs.test.ts) cover baseline/integration/automation, string/number/boolean/path values, `false`, `0`, empty strings, saved/default prefills, and deselection. Workflow prompts occur before `resolveInputs` and `planProject`. |
| 16 | Native YAML/shell without universal substitution | Pass | Loader validates supported native formats; input tests prove YAML/shell literals stay unchanged. Destinations are JSON/JSONC fields only; unsupported/overlapping bindings fail before mutation. |
| 17 | Deterministic, field-specific composition | Pass | [Composition implementation](../src/composition.ts) and the planning composition case cover category/ID order, atomic rule tuples and options, exact plugin/preset deduplication, ordered overrides, and whole-value arrays. [Policy reference](policy.md#compose-oxc-fragments) documents the contract. |
| 18 | Declarations own package entries; `files/` owns native content | Pass | [Bundle schemas](../src/bundle-types.ts) and loader reject unknown fields and nested `files/package.json`; there is no script-group registry. Bundle/planning suites exercise familiar maps and native files. |
| 19 | Sequential script composition, exact deduplication, failure stops later tasks | Pass | [Script suite](../test/scripts.test.ts) executes real POSIX shells with compound expressions, comments, pipelines, heredocs, multiline input, exact duplicates, and early failures. Real managers execute generated wrappers too. |
| 20 | Reserved helpers preserve originals and restore on identifiable removal | Pass | [Script planner](../src/scripts.ts) and deselection/rerun/manager-change tests verify helpers, exact original command preservation, no append churn, restoration, and removal of originally absent commands. |
| 21 | Edited wrappers fail actionably, without shell rewriting | Pass | Only exact wrapper forms are recognized. Script tests verify edited helper references and unowned namespace collisions fail without mutation. |
| 22 | Conflicting dependency requirements fail with source details; no resolver | Pass | Planner compares literal requirements and reports both bundle sources. Planning tests reject differing/overlapping-range requirements before writes; the native manager owns resolution. |
| 23 | Dedicated workflow preservation and bounded shared-hook edits | Pass | [Automation suite](../test/automation.test.ts) covers ownership markers, hard conflicts, surrounding bytes, CRLF/BOM/no-final-newline cases, malformed blocks, edits, enable/disable, and shared contributions. Real Husky dispatch passes/fails locally; hosted Actions are not claimed. |
| 24 | Accommodate core Effect Oxlint declarations without initial integration/LSP scope | Pass by design inspection | Native preset references are retained by composition; dependency maps and opaque `prepare` commands support the specified shape. Generic prepare/preset tests cover those mechanisms. No Effect integration or editor/LSP adapter is shipped or runtime-certified. |
| 25 | New integration directory appears without registry edits | Pass | Directory discovery is filesystem-based. [Bundle discovery](../test/bundles.test.ts) and [fork-author policy tests](../test/policy.test.ts) add a directory and observe it without installer changes. |
| 26 | Feature tests at planning/application seams | Pass | Tests exercise discovery, resolution, plans, application, workflow, and the consequential process/filesystem seams. Smaller real shell, manager, tool, PTY, package, and GitHub checks establish behavior that substitutes cannot prove. |
| 27 | Owner independently edits baseline and integration policy | Owner accepted | The owner stated the independent test had already been performed and explicitly approved it in this conversation. #11 was then closed at the owner's request. Agent-authored fixture edits are not used as a substitute. |
| 28 | Upstream/fork distribution and deferred experiment | Approved replacement; verified | The owner authorized #2, its temporary remote fixtures, and later direct TypeScript/Bun distribution instead of prebuilt JavaScript. Default-branch plus optional commit-pinned launch is documented and tested. #2 is closed with that decision recorded. The original “not yet”/compiled proposal text is superseded, not an outstanding implementation requirement. |

## Findings

### A1. Tailwind tooling advisory needs an explicit risk decision

Fresh audits of both reference and live combined graphs report seven moderate affected packages and no high/critical entries. They trace to one advisory: [GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249), potential denial of service through `minimatch` globparts amplification.

The installed `minimatch` version is 10.2.6; the advisory identifies versions below 11.0.1 as affected and requires attacker-controlled patterns with `optimizationLevel >= 2`. The affected tooling chain includes `eslint-plugin-tailwindcss` 4.4.0 and its ESLint/TypeScript utility dependencies. ESLint is incidental dependency infrastructure, not an additional configured linter or fallback.

This audit did not establish whether those triggering conditions are reachable in the configured tool paths. Development-tool context does not prove non-exploitability. npm's proposed remediation changes the plugin version; do not blindly run a forced audit fix or override a major dependency version without rechecking tool compatibility.

The older #1 decision-review comment already called for owner review of seven moderate transitive advisories. This audit confirms that the concern remains current; the earlier editing approval is not treated as a security-risk waiver. The owner can accept the documented risk or request a separate compatibility-preserving remediation.

### A2. Schema revision descriptions lag the selected provenance contract

[`schemas/selections.schema.json`](../schemas/selections.schema.json) describes `$schema` as being at the “immutable generating revision” and `source.revision` as “identifying the generating policy.” However, [`policy/bundle.json`](../policy/bundle.json) deliberately pins a known schema-containing commit, independently of the executing code/policy revision. [`docs/policy.md`](policy.md#source-identity-and-the-editor-schema) correctly states that distinction, and the earlier #1 provenance decision records it.

The runtime contract is consistent and offline. The [generated schema URL](https://github.com/ItsEthanDev/its-checks/raw/85e709004b65df77a1fa13ac8f7c119784c82602/schemas/selections.schema.json) returned HTTP 200, resolved to the intended immutable raw GitHub schema, and matched the local schema byte for byte (SHA-256 `663153d91c571407707dfd58067a67682b5401bbaa5512b6767dd7d0ebe2665a`). The pin is not a broken link or a launch-version selector.

Clarify the schema descriptions so readers do not mistake the schema pin for the actual executing revision. This is a documentation finding, not a request to add execution history or automatic project pinning. No wording or schema pin was changed during this audit.

## Limits, not additional passed coverage

- Target-manager support is bounded by [the exact versions/settings](package-managers.md#supported-environments), single-package targeting, Linux x64, and POSIX scripts. Other platforms, custom linkers/shells, workspaces, and general peer/optional/platform combinations remain unverified.
- Whole-policy compatibility is npm-verified. The other managers have real adapter coverage, not proof of the entire Oxc/plugin graph on each manager.
- Hosted Actions execution and Convex policy compatibility remain unverified. Actions files are authored/parsed and preserved; local Husky dispatch is actually executed. Neither hosted deployment nor Convex was an initial-release acceptance requirement.
- No-history cleanup cannot reconstruct retired definitions. Native inventory cannot prove arbitrary externally changed lifecycle commands or effects after abrupt termination. Bun failure retry needs an eligible approved direct store link; missing/nonregular retry artifacts can block guaranteed recovery. Those limits remain visible, not silently counted as reliable automatic recovery.
- Default-branch caching can reuse old code/policy, especially in Bunx. Commit selection is an optional operational choice; neither source pinning nor the clean checkout lockfile audit guarantees every future transitive dependency resolution.
- Both disposable GitHub probe repositories still existed at the audit's read-only check. The owner chose manual deletion after credential scope blocked agent deletion. This is remaining housekeeping, not a product behavior failure; fixture histories are archived.

## Audit disposition

No application, policy, tests, launch commands, or dependency versions were changed. No issues were closed, no checkbox/status edits were made, and no pushes or deployments were performed during the audit. The report is the only repository change.

Before closing #1: decide A1 and give final product acceptance within the stated limits. A2 was subsequently resolved by the simplified intent format. The independent editing acceptance is already complete.
