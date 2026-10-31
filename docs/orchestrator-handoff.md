# Orchestrator handoff

## Mission and start condition

Implement its-checks through the approved implementation tickets, using subagents for each implementation slice. Preserve the orchestrator's context for coordination, decisions, acceptance, and final verification.

This handoff does not start implementation. Begin when the user authorizes the implementation run. Follow applicable repository, agent, tool, and action-authorization instructions. Local implementation, verification, and commits are the intended work; pushes, PRs, remote issue updates, releases, deployments, and remote fixture creation require a separate applicable grant.

## Authoritative requirements

Read these sources before scheduling work:

- [Specification #1](https://github.com/ItsEthanDev/its-checks/issues/1): product motivation, settled decisions, accepted limitations, open details, and acceptance criteria.
- [Implementation subissues #3–#11](https://github.com/ItsEthanDev/its-checks/issues/1): retrieve the parent’s native subissue list and each issue's full body, including scope, exclusions, and dependencies.
- [Packaging validation #2](https://github.com/ItsEthanDev/its-checks/issues/2): read its constraints, but leave its experiment deferred until separately authorized.

The spec owns product requirements; tickets own implementation scope; this handoff owns execution procedure. If they conflict, identify the conflict rather than silently selecting convenient requirements. Proposed changes in remote comments are not permission to widen scope.

Read `docs/research/oxc-configuration.md` when implementing native configuration composition or investigating Oxc capabilities. It is research, not a verified released-version compatibility matrix or an alternative specification.

Completion criterion: maintain a requirement-to-ticket map and identify all genuinely unresolved choices before assigning the first slice.

## Bootstrap the workspace

1. Inspect current files, Git status, branch, remotes, and applicable instructions. Preserve existing local work. Initialize a local checkout only if needed; do not clone over an occupied directory or discard existing commits.
2. Verify the repository target is `ItsEthanDev/its-checks` before authenticated access. Read issues without modifying them unless authorized.
3. Inspect available Node, development package manager, Git, and test tools. Verify the actual Effect v4 package/API against first-party documentation. Do not use remembered v3 examples as v4 implementations.
4. Establish the development dependency/test approach in the first implementation slice. Inspect lifecycle scripts and consequential external effects before running installs or test commands. Handle unavailable tooling as a prerequisite, not permission for system-wide changes.
5. Make a clean, verified local checkpoint before creating managed worktrees. Preserve unrelated or untracked files; do not stage them merely to obtain a clean worktree.

Completion criterion: the first subagent has an explicit working directory, a known baseline commit, access to its requirements, and the tools needed for its bounded assignment.

## Slice map and scheduling

| Ticket | Slice | Prerequisites |
| --- | --- | --- |
| [#3](https://github.com/ItsEthanDev/its-checks/issues/3) | Bundle loading, discovery, and validation | None |
| [#4](https://github.com/ItsEthanDev/its-checks/issues/4) | Inputs, saved selections, and provenance | #3 |
| [#5](https://github.com/ItsEthanDev/its-checks/issues/5) | Configuration/dependency/migration planning | #3, #4 |
| [#6](https://github.com/ItsEthanDev/its-checks/issues/6) | Script composition and preservation | #5 |
| [#7](https://github.com/ItsEthanDev/its-checks/issues/7) | Safe application and recovery | #4, #5, #6 |
| [#8](https://github.com/ItsEthanDev/its-checks/issues/8) | Hook/workflow preservation | #7 |
| [#9](https://github.com/ItsEthanDev/its-checks/issues/9) | Project package-manager operations | #7 |
| [#10](https://github.com/ItsEthanDev/its-checks/issues/10) | Clack workflow | #4, #8, #9 |
| [#11](https://github.com/ItsEthanDev/its-checks/issues/11) | Functional policy and owner acceptance | #10 |

Use dependency-gated scheduling, not forced parallelism. #8 and #9 may run independently after #7 if file ownership is separated. #6 and #9 must agree on runner conventions; this coordination is not a circular implementation dependency. Define the small shared contract before assigning either dependent implementation.

A ticket can contain smaller slices when needed. Each implementation slice goes to a subagent with a bounded assignment. Keep direct orchestrator changes to execution records and small integration corrections; delegate substantive implementation or redesign back to a slice owner.

## Subagent assignment contract

Use a fresh bounded subagent for each slice. Give it:

- Objective, ticket URL/body, and the relevant spec sections.
- Baseline commit, working directory/worktree, and exclusive file/module ownership.
- Established interfaces and the accepted prerequisite artifacts it may rely on.
- Acceptance criteria, exclusions, and relevant verification commands.
- Permission limits: local work only unless separately authorized; no nested delegation unless explicitly assigned; no remote publication or issue closure.
- A required return report: changed files, commit IDs if any, behavior delivered, tests run and results, limits of those checks, unresolved decisions, and blockers.

Subagents implement and verify their own slices. Their reports are evidence to inspect, not acceptance decisions. They must not claim completion because code compiles, tests were weakened, or only their own mocked internals passed.

Use one writer per working directory. Isolate concurrent writers in worktrees, and integrate only reviewed work. When parallel work is not safe or useful, run slices sequentially. Use the installed subagent guidance and native completion notifications rather than polling or keeping verbose tool transcripts in the orchestrator's context.

Completion criterion: each returned slice has inspectable code, requirement-linked behavior evidence, and a bounded report.

## Orchestrator acceptance and commits

For each returned slice:

1. Inspect the actual diff and relevant behavior tests against the ticket and spec. Check that interfaces remain small and policy is not being hardcoded into mechanics.
2. Resolve cross-slice decisions and review changed assumptions. Accept only work that satisfies its criteria or is explicitly identified as a partial result.
3. Integrate accepted changes and run the affected checks on the integrated tree. A child's isolated result does not prove integration works.
4. Commit at appropriate verified checkpoints: the bootstrap, each accepted feature slice, and coherent integration fixes. Make checkpoints regularly rather than accumulating the full implementation into one commit. Stage only files belonging to the change.
5. Leave incomplete work clearly isolated and reported; do not commit it as an accepted feature. If a child made commits, review and integrate those commits instead of creating redundant commits solely for ceremony.

Use a compact local execution log, for example `docs/implementation-status.md`, to record ticket/slice status, accepted commits, important decisions, evidence references, and blockers. Keep detailed command output in bounded artifacts rather than copying it into the log or conversation. Remote issue status remains unchanged without permission.

Completion criterion: every accepted slice has reviewed evidence, an integrated verification result, and a coherent local commit.

## Autonomous decisions and blockers

Resolve low-level implementation choices within the spec autonomously: schemas, module structure, validation details, development tools, and tested version choices. Record consequential rationale once near its owning contract. Do not ask the owner to prescribe initial lint/format/hook/CI policy.

Treat a missing prerequisite, contradictory requirement, required scope change, unavailable permission, or failed essential verification as a genuine blocker. Distinguish it from a design choice the ticket authorizes you to make.

When blocked:

1. Record the exact failure, affected acceptance criteria, evidence, and the input or permission needed.
2. Mark the blocked slice and all work that actually depends on it. Do not continue those paths using guessed prerequisites, fabricated results, weakened tests, or an unapproved substitute design.
3. Continue independent unblocked slices or independently verifiable subtasks with clear ownership. Preparation may proceed only when it does not assume the blocked result or claim dependent completion.
4. Recompute the runnable frontier after every completion or blocker. Stop autonomous execution only when the requested work is done or no authorized runnable work remains.
5. Report outstanding blockers together with completed work and the smallest decisions needed to resume.

An orchestration/tool failure is also a blocker for that execution route. Follow the subagent tool's recovery rules; do not silently replace failed delegation with another unapproved execution mechanism.

## Final verification: orchestrator-owned

After integrating the implementation, the orchestrator owns the final acceptance decision for machine-verifiable requirements. Subagents may run supporting checks or independent reviews, but the orchestrator must inspect their evidence and run the final integrated verification path.

Verify the full behavior against #1 and the tickets, including:

- Discovery, invalid-bundle failures, inputs, saved intent, and offline schema handling.
- Selected-bundle composition replacing dedicated formatter/linter configuration, not inheriting existing project rules.
- Migration/deselection limits, dependency conflicts, and preservation of unrelated package content.
- Script ordering/failure behavior, exact deduplication, reserved helpers, wrapper reruns, restoration, and edited-wrapper conflicts.
- Marked hook preservation and dedicated workflow conflict handling.
- Target package-manager operations in explicitly tested environments, including no-ops and installation failure/retry.
- Clack selection, prefill, cancellation, plan confirmation, noninteractive rejection, and truthful partial-failure reporting.
- Functional shipped baseline/Tailwind/automation policy and changes to policy taking effect without installer edits or rebuilds.

Use real policy files and temporary target projects through planning/application seams. Substitute consequential external operations only where appropriate; use real execution for shell, CLI, and package-manager claims that substitutes cannot prove. State unavailable environment coverage as blocked or unverified, not passed. Perform no deployment, publication, GitHub Actions run, or packaging experiment merely to improve coverage.

Finish with a report of accepted tickets/commits, final checks and observed results, remaining limitations, blockers, and exact next human actions. Leave the working tree clean for completed work or explain every remaining change. Do not push or close issues without a separate grant.

## Human and deferred acceptance

The orchestrator may accept machine-verifiable implementation work; it cannot impersonate the owner's independent policy-editing pass in #11. Prepare the example project and instructions, and report that criterion as awaiting owner acceptance.

Likewise, #2 remains deferred: upstream/fork GitHub execution and distribution are not verified until its separately authorized experiment is completed. Never describe the project as fully release-accepted while either required gate remains outstanding.
