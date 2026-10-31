# Implementation status

## Authority and baseline

Implement specification [#1](https://github.com/ItsEthanDev/its-checks/issues/1) through its native subissues #3–#11. Local implementation, dependency setup, tests, commits, and decision comments only. No pushes, PRs, issue edits/status changes, publication, deployment, or packaging experiment.

Initial baseline: `3422686` on `main`. No Git remote is configured; GitHub API confirms `ItsEthanDev/its-checks`. Existing untracked `docs/research/oxc-configuration.md` is preserved, not staged. Use sequential single writers in this checkout; managed worktrees require a separate clean checkpoint first.

## Requirement map and dependency gates

| Ticket | Requirements / acceptance seam | Depends on | Status |
| --- | --- | --- | --- |
| #3 | Effect v4 bootstrap; external bundle schemas, native JSONC/shell/YAML, discovery, validation/source errors | none | accepted |
| #4 | Saved intent, offline revision-pinned schema/source provenance, declared inputs of every bundle kind, prefill/binding | #3 | accepted |
| #5 | Standalone config composition, dependency collision checks, targeted manifest edits, explicit migration and no-history deselection, deterministic read-only plans | #3, #4 | accepted |
| #6 | Same-name sequential fail-fast scripts, exact deduplication, reserved helpers, intact wrappers/restoration and edit conflicts | #5 | accepted |
| #7 | Approved-plan-only application, no-op writes, intent before installation, truthful partial failure/retry | #4–#6 | accepted |
| #8 | Dedicated workflow conflicts, marked shared hooks and unrelated-content preservation | #7 | accepted |
| #9 | Target npm/pnpm/Yarn/Bun detection, actual install-state/no-op/retry, lifecycle and runner behavior | #7 | accepted (bounded matrix) |
| #10 | Interactive-only Clack flow, explicit choices each run, inputs, cancellation, one conflict confirmation, truthful reporting | #4, #8, #9 | accepted |
| #11 | Real baseline/Tailwind/Husky/Actions policy compatibility; policy-only changes; author guidance and owner acceptance fixture | #10 | machine work accepted; human gate pending |
| #2 | Git-reference distribution, executable freshness/caching, upstream/fork launch experiments | separate authorization | deferred |

Final machine acceptance belongs to the orchestrator. Owner-independent baseline/integration editing remains a human gate; packaging #2 remains deferred.

## Choices to settle at owning gates

No contradictory requirement identified. The following are implementation choices, not requests for initial owner policy:

- #3: exact Effect v4/development tool versions; declaration schema, safe path/file constraints and validation.
- #4: selection filename/schema dialect; immutable schema revision mechanism; input types/defaults/destinations/path existence and deselection rules.
- #5: field-specific composition beyond settled rule/plugin/override/extends operations; dependency-section collisions and cleanup identity.
- #6/#9 shared contract before #6: target managers `npm`, `pnpm`, `yarn`, `bun`; public wrapper invokes `<manager> run its-checks:<name>`; helpers group opaque POSIX-shell expressions with sequential `&&`. Verify actual shell behavior; declare platform limits, never claim untested Windows support.
- #7: approved-plan representation, stale-plan safeguards, operation-level partial reporting.
- #8: dedicated automation identity, malformed/duplicate marker handling and safe removal.
- #9: manager evidence ambiguity, supported versions, actual-state and failed-install retry evidence.
- #10: presentation adapter and real terminal coverage.
- #11: released Oxc/Tailwind/plugin matrix, initial commands and automation opinions. Compatibility failure blocks that policy rather than authorizing ESLint fallback.

## Environment evidence

Node `24.21.0`, npm `11.19.0`, pnpm `12.9.0`, Bun `1.4.0`; Git and gh available. npm registry reports Effect latest `4.1.1` (v4), beta `4.0.0-beta.107`. First-party v4 docs: https://effect.website/docs/v4/ . Exact installed APIs and lifecycle effects must be checked by bootstrap owner before use.

## Accepted checkpoints and evidence

- Requirements/bootstrap inspection: native subissue list and complete issue bodies #1–#11 read through GitHub API.
- #3: accepted bundle-loading seam and exact Effect 4.1.1 harness after inspecting implementation and fixture tests. Integrated `npm test`: 47 passed; `npm run typecheck`: passed; `git diff --check`: passed. Evidence: `test/bundles.test.ts`, reference: `docs/bundle-loading.md`. No shipped policy or tool-specific configuration compatibility claimed.

- #4: accepted offline intent/input seams and real JSON Schema after inspecting code and behavioral fixtures. Integrated `npm test`: 54 passed; typecheck and diff checks passed. Evidence: `test/inputs.test.ts`, `docs/saved-intent.md`. Shipped metadata must pin the schema-containing local commit; remote schema availability is not established under the no-push constraint.

- #5: accepted read-only planning/composition after code and fixture inspection. Integrated `npm test`: 79 passed; typecheck passed. Evidence: `test/planning.test.ts`, `docs/planning.md`. Scripts and automation are explicitly deferred/incomplete without their adapters; #7 must reject incomplete plans. No application/tool-version claims.

- #6: accepted script adapter after inspecting code and real-shell feature tests. Integrated `npm test`: 88 passed; typecheck passed. Evidence: `test/scripts.test.ts`, `docs/scripts.md`. Real Linux `/bin/sh` (Bash), fake manager runners only; actual manager/lifecycle evidence remains #9.

- #7: accepted application after source/feature-test inspection. Integrated `npm test`: 101 passed; typecheck passed. Evidence: `test/application.test.ts`, `docs/application.md`. Partial filesystem/dependency failures are exercised through external seams; actual manager state remains #9. No rollback or concurrent-filesystem sandbox claim.

- #8: accepted integrated automation preservation after code/tests inspection. Integrated `npm test`: 119 passed; typecheck passed. Evidence: `test/automation.test.ts`, `docs/automation.md`. All automation now uses complete snapshots; previous deferred-plan test replaced by hard-conflict behavior tests. No hook/Actions execution claimed.

- #9: accepted supported matrix after source/test inspection and orchestrator execution. `npm test`: 126 passed; typecheck passed; `npm run test:managers`: 4 passed, 24 real installs including 4 late lifecycle failures, retry/no-op/update/remove/lock drift/wrappers. Exact environments: npm 11.19.0; pnpm 12.9.0 with CLI management disabled; Yarn Classic 1.22.22; Bun 1.4.0 isolated. See `docs/package-managers.md`. Yarn Berry/PnP and other versions/platforms unsupported. Bun failure without an eligible generated direct dependency link cannot guarantee retry; external/abrupt lifecycle-only failures can leave indistinguishable state. These limits are not claimed passed. CLI must preview dependency/environment assessment before mutation.

- #10: accepted Effect workflow and native Clack presentation after source/test inspection. Integrated `npm test`: 136 passed; typecheck passed; `ITS_CHECKS_SHOW_TERMINAL=1 npm run test:cli`: 4 passed. Orchestrator inspected real rendered choices, saved numeric/boolean/string/path prefills, removal plan and single declined confirmation. Child also reran real-manager suite: 4 passed; final orchestration will rerun all suites. Evidence: `test/workflow.test.ts`, `test/cli.pty.py`, `docs/cli.md`. Linux PTY path only; source CLI, no distribution claim.

- #7 recovery correction: independent review found selection-first writes lost deselection identity on later filesystem failure. Fixed by selection-last-before-dependencies and staged complete selection publication; failed-cleanup/replan and partial-selection-write regressions pass. Orchestrator integrated suite: 140 passed and typecheck passed (includes pending #11 policy tests). Real npm shipped-policy/Husky suite also passed. Final review finding resolved; transient sibling is not historical state.

- #11: accepted functional policy and author/owner artifacts after inspecting native files and tests. Orchestrator `npm test`: 140 passed; typecheck passed; `npm run test:policy`: 1 passed, 2 normal npm adapter installs following lifecycle-graph audit, real Oxfmt/Oxlint/Tailwind checks/fixes, real local Husky pass/fail, matching no-op. Evidence: `test/policy.test.ts`, `test/policy-compatibility.integration.ts`, `docs/policy-compatibility.md`. Full policy graph on pnpm/Yarn/Bun unverified; remote Actions not executed. Human independent editing pass still pending. Observed 7 moderate transitive plugin-peer advisories documented; no automatic override. Schema content is locally pinned; remote URL availability unverified.

## Decision review

- [#3 bootstrap and declaration contract](https://github.com/ItsEthanDev/its-checks/issues/3#issuecomment-6541569287).

- [#4 saved intent, input and schema choices](https://github.com/ItsEthanDev/its-checks/issues/4#issuecomment-6541628770).

- [#5 composition, dependency placement and plan contract](https://github.com/ItsEthanDev/its-checks/issues/5#issuecomment-6541716302).

- [Shared #6/#9 runner and shell contract](https://github.com/ItsEthanDev/its-checks/issues/1#issuecomment-6541718736).
- [#6 wrapper recognition and namespace conflicts](https://github.com/ItsEthanDev/its-checks/issues/6#issuecomment-6541765788).

- [#7 approval, partial writes and recovery contract](https://github.com/ItsEthanDev/its-checks/issues/7#issuecomment-6541816469).

- [#8 native ownership markers and reversible hook blocks](https://github.com/ItsEthanDev/its-checks/issues/8#issuecomment-6541859120).

- [#9 native retry evidence](https://github.com/ItsEthanDev/its-checks/issues/9#issuecomment-6541870999), [Bun refinement](https://github.com/ItsEthanDev/its-checks/issues/9#issuecomment-6541881532), [tested matrix and evidence](https://github.com/ItsEthanDev/its-checks/issues/9#issuecomment-6542010741).

- [#10 terminal flow and retired-selection reconciliation](https://github.com/ItsEthanDev/its-checks/issues/10#issuecomment-6542098294).

- [#7 recovery finding](https://github.com/ItsEthanDev/its-checks/issues/7#issuecomment-6542128363) and [verified correction](https://github.com/ItsEthanDev/its-checks/issues/7#issuecomment-6542231478), superseding selection-first ordering.

- [#11 initial policy and compatibility tradeoffs](https://github.com/ItsEthanDev/its-checks/issues/11#issuecomment-6542237245).
- [Schema revision/publication distinction](https://github.com/ItsEthanDev/its-checks/issues/1#issuecomment-6542238502).

Final review index belongs on spec #1.
