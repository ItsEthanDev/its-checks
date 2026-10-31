# Integrated verification

Autonomous implementation and machine verification are complete. This is **not full release acceptance**: the independent owner editing pass, remote schema availability, and separately authorized distribution experiment remain open.

[Decision-review index on spec #1](https://github.com/ItsEthanDev/its-checks/issues/1#issuecomment-6542287939). No requirement-change proposals await approval. Two recovery defects found during review were corrected and regression-tested before acceptance.

## Final observed run

Orchestrator executed the following against implementation commit `de52e32eb56a5000f7a022676de2118927af0b14`, after inspecting scripts, fixtures, lifecycle auditing, and external effects. Subsequent checkpoints change documentation only.

| Command | Observed result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed; 15 development/runtime packages installed, lifecycle disabled |
| `npm test` | 141 passed, zero failed/skipped |
| `npm run typecheck` | Passed |
| `ITS_CHECKS_SHOW_TERMINAL=1 npm run test:cli` | 4 real Clack/Python PTY cases passed; captured rendering inspected |
| `npm run test:managers` | 4 passed; 25 actual installs, including 5 intentional late lifecycle failures and successful retries |
| `npm run test:policy` | 1 passed; 2 normal npm adapter installs after auditing 5 baseline/123 combined installed manifests; real Oxc/Tailwind checks/fixes and local Husky pass/fail |
| `git diff --check` | Passed |

Tests remove their temporary projects/audit trees by default. No pushes, PRs, issue-body/status changes, remote fixtures, publication, deployment, hosted Actions, or packaging/distribution experiment occurred. Only authorized decision/assumption comments were posted.

## Requirement evidence

| Behavior | Repeatable evidence |
| --- | --- |
| External policy, deterministic directory discovery, malformed declarations/native files, source context, no executable installers | `test/bundles.test.ts` |
| Baseline/integration/automation inputs, explicit answers, prefill, JSONC binding, offline schema and saved intent | `test/inputs.test.ts` |
| Standalone replacement composition, atomic rules/options, ordered plugins/extends/overrides, dependency collisions, explicit migration without config execution, shared requirements/no-history cleanup | `test/planning.test.ts` |
| Exact script deduplication/order/failure, opaque expressions, helpers/wrappers, restoration and edited-wrapper conflicts | `test/scripts.test.ts`; real runner execution in `test/real-managers.integration.ts` |
| Declined/stale/incomplete plans, exact approved output, no-write mtimes, filesystem/install partial failure, intent preservation and deselection recovery | `test/application.test.ts` |
| Marked hook preservation/removal, malformed block rejection, dedicated workflow hard conflicts, native command edits | `test/automation.test.ts` |
| Manager ambiguity, unsupported environments, actual native install state, no-op, false-success rejection, retry/removal failures | `test/package-managers.test.ts`, `test/manager-environments.test.ts`, `test/real-managers.integration.ts` |
| Always-visible choices, preselection/input prefills, cancellation/decline, complete plan and pre-mutation dependency assessment, truthful failure | `test/workflow.test.ts`, `test/cli.pty.py` |
| Shipped baseline/Tailwind/Husky policy, real formatter/linter/fixes, policy-only edits and new directory discovery, no-op reruns | `test/policy.test.ts`, `test/policy-compatibility.integration.ts` |

The source uses TypeScript and verified Effect 4.1.1 APIs; native Clack 1.8.1 supplies presentation. Schema references are decoded offline. Policy remains external and requires no rebuild for ordinary edits.

## Tested environment and boundaries

Linux x64, Node 24.21.0, POSIX `/bin/sh` (Bash). Target adapters: npm 11.19.0; pnpm 12.9.0 isolated with `manage-package-manager-versions=false`; Yarn Classic 1.22.22 with `node_modules`; Bun 1.4.0 with explicit isolated linker/text lock. Other versions/platforms/shells, Yarn Berry/PnP, and untested manager overrides are not supported claims. See [manager constraints and recovery limits](package-managers.md).

The full native policy graph is verified on **npm only**: Oxfmt 0.75.0, Oxlint 1.90.0, Tailwind 4.3.3, eslint-plugin-tailwindcss 4.4.0, Husky 9.1.7. Other managers have real local-archive adapter/lifecycle/wrapper evidence, not full native-policy-graph evidence. Actions is locally parsed/preserved/formatted, not remotely executed. Seven moderate transitive advisories were observed in the plugin peer graph; no unverified override was applied. See [released policy evidence](policy-compatibility.md).

No transactional rollback, power-loss durability, hostile-filesystem sandbox, or historical ownership inventory is promised. Native install state cannot prove arbitrary external/abrupt lifecycle-only completion. Bun recovery without an eligible generated direct dependency link is explicitly not guaranteed. Renamed/vanished policy setup and Husky lifecycle Git settings/dispatch files can require manual cleanup. Tailwind currently asks twice for the same stylesheet under the one-destination input contract.

## Outstanding gates and next actions

1. Review the linked decision index, including superseded recovery choices, schema revision semantics, compatibility limits, and advisories.
2. Perform and record the independent baseline **and** integration editing pass in [owner acceptance](owner-acceptance.md). Agent-authored policy-edit tests do not satisfy this gate.
3. Establish the pinned schema's remote availability only after separately authorizing the necessary publication. The schema-containing commit exists locally; its GitHub URL has not been verified remotely. Nothing was pushed.
4. Separately authorize issue #2 before the deferred Git-reference distribution/compiled-executable experiment. No launch commands, executable freshness, fork execution, or caching claims are accepted yet.

No autonomous implementation blocker remains within the documented tested scope. The pre-existing untracked `docs/research/oxc-configuration.md` was read as required and left unchanged/unstaged; it is not part of these implementation commits.
