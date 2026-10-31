# Applying approved plans

`src/application.ts` applies the exact [`ChangePlan`](planning.md) using Effect 4.1.1. It does not reload policy, recompose configuration, run executable configs, detect package managers, or present prompts.

```ts
const report = yield* applyPlan(approvedPlan, {
  approved: true,
  dependencies: dependencyAdapter,
});
```

Pass the same plan shown for confirmation. `approved` must be explicitly `true`, including when creation-only changes need no conflict question. Omitted or false approval returns `status: "declined"` without filesystem or dependency operations. An approved plan must have `complete: true`; otherwise application fails before mutation. Script planning must already be supplied and preservation-sensitive automation must be fully planned. Application cannot fill deferred work itself.

## Execution contract

Application checks the complete snapshot before any mutation, including unchanged files and absent migration candidates. Changed bytes, modes, existence, unsafe traversal, or symlinks stop application. Each changed destination is checked again immediately before mutation. Application writes only approved `after` bytes and permission bits, removes only approved files, and creates missing parent directories individually. It never deletes parent directories, including now-empty directories left by deselection.

Matching file states cause no filesystem mutation, including chmod. Existing manifest bytes from the plan are applied as a whole; the planner's targeted edits preserve unrelated manifest values. Application does not independently merge another manifest. Configuration and the single `.its-checks.json` intended-selection file finish before dependency assessment or installation begins. Saved input answers are included in the approved selection-file bytes; there is no second success marker, backup, or ownership inventory.

A snapshot check is not a filesystem lock. Root ancestors are trusted local paths; concurrent hostile filesystem changes are not sandboxed. The native writer refuses leaf symlinks with `O_NOFOLLOW`, uses exclusive creation for absent files, explicitly applies the planned mode, and closes open handles. In-place writes can leave truncated or partial content if truncation, writing, chmod, or close fails. There is no atomic multi-file transaction or rollback.

## Dependency adapter

`ApplicationDependencies` has two typed Effect operations:

- `assess(plan)` is read-only and returns `"required"` or `"not-required"` from actual dependency state. It runs even when every configuration file matches. Do not use saved intent as proof of installation or treat unchanged manifest requirements as proof of installed packages.
- `install(plan)` reconciles the approved manifest when assessment returns `"required"`. It must not choose different requirements or independently replan configuration. Return `OperationError` on failure, including a useful description of any observed downstream partial work.

The adapter is required; application supplies no pretend-success default. A matching, installed project has no writes or installation. A matching project after a failed installation can still request installation. Manager detection, actual dependency-state checks, manager commands, lockfiles, and lifecycle behavior belong to the package-manager adapter (#9), not this module.

## Filesystem adapter and reports

`nodeApplicationFileSystem` is the default local adapter. `ApplicationFileSystem` exposes only consequential `createDirectory`, `writeFile`, and `removeFile` operations. Tests can substitute a failing adapter at this external seam; traversal checks and post-operation observations still use the actual temporary filesystem. Successful adapters must produce the requested bytes/mode; application checks the result. Adapter failures use `OperationError` and must not silently ignore partial work.

Success returns `ApplicationReport` with `status: "completed"`, completed operations, no incomplete operations, and `dependencyWork` (`"not-required"` or `"completed"`). Declined reports list prospective incomplete operations but have no completed operations. These are not claims that dependencies were assessed.

Failures return a typed `ApplicationError` with a phase (`validation`, `filesystem`, or `dependencies`), diagnostic detail, and a report:

- `completed` contains operations whose success was observed, including created parent directories.
- `failed` identifies the failed operation, when an operation was attempted.
- `incomplete` contains the failed and remaining work, including dependency assessment/installation when not yet finished. Parent directories discovered during application are included if they fail.
- `observed` reports actual bytes/mode/absence after a failed file operation, or a directory's observed mode after failed creation. `"unavailable"` means inspection also failed. A failed operation can have produced its intended state before reporting an error; it remains incomplete rather than being relabeled successful.
- `dependencyWork` distinguishes not-yet-assessed work, required installation, not-required installation, and completed installation.
- `retry` directs the caller to inspect partial state, fix the cause, and build and approve a fresh plan.

Application stops at the first typed failure. It does not attempt later writes or installation, restore earlier content, or claim downstream rollback. Installation is one external operation: its internal lockfile changes and lifecycle effects are not individually inventoried by application. Interrupted processes or defective adapters may prevent a report; rerun through fresh planning and actual-state dependency assessment rather than replaying an already-stale plan.

## Verification

`test/application.test.ts` uses temporary projects and real native policy, applying plans through the public interface. It covers declined/unapproved, incomplete and stale plans; exact approved output despite later policy edits; replacement, explicit migration and deselection; unrelated manifest/files; executable and existing modes; missing parents; matching bytes and mtimes with forbidden mutation adapters; symlinks; injected partial filesystem failure; retained configuration/intent on install failure; and matching-config recovery through the dependency seam.

Run `npm test` and `npm run typecheck`. These tests do not execute the fixture's existing `install: exit 99`, real package managers, hooks, UI, remote services, distribution, or compatibility experiments. Actual dependency-state detection is not established by the test adapter.
