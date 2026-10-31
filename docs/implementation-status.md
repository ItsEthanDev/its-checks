# Implementation status

## Authority and baseline

Implement specification [#1](https://github.com/ItsEthanDev/its-checks/issues/1) through its native subissues #3–#11. Local implementation, dependency setup, tests, commits, and decision comments only. No pushes, PRs, issue edits/status changes, publication, deployment, or packaging experiment.

Initial baseline: `3422686` on `main`. No Git remote is configured; GitHub API confirms `ItsEthanDev/its-checks`. Existing untracked `docs/research/oxc-configuration.md` is preserved, not staged. Use sequential single writers in this checkout; managed worktrees require a separate clean checkpoint first.

## Requirement map and dependency gates

| Ticket | Requirements / acceptance seam | Depends on | Status |
| --- | --- | --- | --- |
| #3 | Effect v4 bootstrap; external bundle schemas, native JSONC/shell/YAML, discovery, validation/source errors | none | ready |
| #4 | Saved intent, offline revision-pinned schema/source provenance, declared inputs of every bundle kind, prefill/binding | #3 | pending |
| #5 | Standalone config composition, dependency collision checks, targeted manifest edits, explicit migration and no-history deselection, deterministic read-only plans | #3, #4 | pending |
| #6 | Same-name sequential fail-fast scripts, exact deduplication, reserved helpers, intact wrappers/restoration and edit conflicts | #5 | pending |
| #7 | Approved-plan-only application, no-op writes, intent before installation, truthful partial failure/retry | #4–#6 | pending |
| #8 | Dedicated workflow conflicts, marked shared hooks and unrelated-content preservation | #7 | pending |
| #9 | Target npm/pnpm/Yarn/Bun detection, actual install-state/no-op/retry, lifecycle and runner behavior | #7 | pending |
| #10 | Interactive-only Clack flow, explicit choices each run, inputs, cancellation, one conflict confirmation, truthful reporting | #4, #8, #9 | pending |
| #11 | Real baseline/Tailwind/Husky/Actions policy compatibility; policy-only changes; author guidance and owner acceptance fixture | #10 | pending |
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

- Requirements/bootstrap inspection: native subissue list and complete issue bodies #1–#11 read through GitHub API. No implementation accepted yet.

## Decision review

Material decisions will be linked here after posting to owning tickets. Final review index belongs on spec #1.
