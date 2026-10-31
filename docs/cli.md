# Interactive source CLI

`src/cli.ts` connects the read-only planner and exact-plan application through Effect **4.1.1** and native **@clack/prompts 1.8.1**. There is no shipped policy yet; this source entrypoint requires an authored `policy/` in the executed checkout. Release policy belongs to #11. Compiled executables, package-manager launch commands, and Git-reference distribution remain unverified and are not supplied here.

With Node 24+, run the source entrypoint from the package you want to configure:

```sh
cd /path/to/target-package
node /path/to/its-checks/src/cli.ts
```

Both stdin and stdout must be terminals. Piped input/output and all command-line arguments are rejected before reading the project or policy. There are no unattended flags. Policy resolves relative to the executed `src/cli.ts`, **not** the target directory; one invocation targets only that directory's `package.json`.

## Questions and approval

Every interactive invocation follows this order:

1. Load `.its-checks.json`, then discover the checkout's bundle declarations.
2. Show integration and automation checkboxes, even on matching reruns. Space toggles; Enter confirms. Saved IDs are preselected only when still available. With no options in a category, Clack shows a `None available` checkbox; its value never becomes a selection.
3. Load selected policy and ask its declared baseline, integration, and automation inputs. Saved answers take precedence over declared defaults as editable prefills. Numbers require finite values, booleans use Clack's Yes/No question, and paths require safe target-relative paths; strings may be empty. Answers are validated again by the input resolver before planning.
4. Resolve the target package manager. Ambiguous/missing evidence produces a question showing that evidence, without selecting based on the CLI's launch manager.
5. Build the complete plan using selected policy, prior intent, current-known prior bundle definitions, and the resolved manager's script planner. Perform a mandatory **read-only dependency/environment assessment** before any mutation. Unsupported manager versions/configuration fail here, not after overwriting configuration.
6. Show every changed file, its classification/reasons, changed package entries with before/after values, and expected dependency work. Ask **one** plan-level confirmation for replacements/removals, defaulting to No. Creation-only additions and matching plans do not ask this conflict question.
7. Apply the same displayed plan. Configuration and saved intent precede dependency operations. Application reassesses actual dependencies after configuration rather than trusting the preview or saved intent.

No integration detection occurs. Unknown/retired saved options are named with a manual-cleanup warning, excluded from selectable/preselected IDs, and dropped with their answers when new intent is saved. Their historical setup cannot be reconstructed; the [accepted no-history limits](planning.md#migration-and-deselection) still apply.

Ctrl+C at a question exits 130 without project writes or installation. Declining the conflict question exits normally without mutation. Failures exit 1 with context. An unchanged project still shows choices and input questions, but reports no writes or installation when actual dependency state also matches. A failed installation is not success: the CLI lists completed and incomplete operations, dependency status, and retry instructions; already-applied configuration and intent remain. There is no rollback guarantee. Process termination during application retains the [application limits](application.md).

## Workflow seam

`setup(options)` in `src/workflow.ts` is a UI-independent Effect workflow. `SetupPresentation` supplies question Effects and display operations; `src/presentation.ts` implements it with native Clack prompts, notes, spinner, and outro. `src/cli.ts` owns terminal/argument guards, checkout-relative policy location, failure presentation, and exit codes.

`SetupOptions.dependencies(target)` substitutes only the consequential dependency boundary for workflow tests. Production uses `createDependencyAdapter(target)`. Filesystem reads, bundle loading, inputs, planning, deselection, and application are real. The workflow requires read-only `assess(plan)` before approval; application independently invokes the same dependency adapter after applying configuration. See [saved intent](saved-intent.md), [planning](planning.md), [application](application.md), and [supported manager environments](package-managers.md).

## Verification

```sh
npm test
npm run typecheck
npm run test:cli
npm run test:managers
```

`test/workflow.test.ts` exercises temporary native policy/projects through the workflow and a scripted presentation adapter. It covers saved preselection/prefills, fresh application, exact displayed-plan execution, unchanged reruns, current-known deselection, retired IDs, conflict decline, cancellation at each question stage, noninteractive guards, read-only unsupported-environment failure, post-config reassessment, and truthful installation failure reports. Only dependency operations are substituted; fixture lifecycle commands are never executed.

`npm run test:cli` requires Python 3 on POSIX and uses only its built-in PTY support. It runs the actual source CLI and real Clack against temporary source checkouts and policy fixtures, from a separate target cwd. It verifies Space/Enter selections, editable numeric/string/path and boolean prefills, numeric/path validation, first-run creation without conflict confirmation, a byte/mtime-identical no-op, removal-plan decline, manager ambiguity, Ctrl+C during selection/input/manager questions, and noninteractive rejection before missing project/policy reads. A real empty npm lock/inventory fixture avoids installations without substituting CLI dependencies or adding lifecycle scripts. `ITS_CHECKS_SHOW_TERMINAL=1 npm run test:cli` prints captured native Clack rendering for inspection.

The PTY suite establishes the local Linux/Node terminal path, not every terminal, platform, accessibility mode, Oxc/Tailwind compatibility, lifecycle scenario, or distribution mechanism. The separate manager suite retains its existing prerequisites and real-operation coverage; the CLI suite does not replace it. Clack's lifecycle declarations were inspected before installation, and resolved transitive declarations were also inspected. Installation used `--ignore-scripts --no-audit --no-fund`, with exact direct versions and lockfile-pinned transitive versions.
