import { Effect, Schema } from "effect";

import {
  applyPlan,
  type ApplicationError,
  type ApplicationDependencies,
  type ApplicationReport,
  OperationError,
  createDependencyAdapter,
  resolveTargetManager,
  type ManagerResolution,
  type TargetManager,
} from "../../application/index.ts";
import {
  planProject,
  type ChangePlan,
  type PlanError,
  type PackageManager,
} from "../../planning/index.ts";
import {
  discoverPolicy,
  loadPolicy,
  enumerateInputs,
  resolveInputs,
  loadPreviousIntent,
  type BundleError,
  type BundleInfo,
  type LoadedPolicy,
  type PolicyCatalog,
  type PolicySelections,
  type DeclaredInput,
  type Answer,
  type SavedIntent,
} from "../../policy/index.ts";

export class Cancelled extends Schema.TaggedError<Cancelled, { readonly brand: unique symbol }>()(
  "Cancelled",
  {},
) {}
export type Question<A> = Effect.Effect<A, Cancelled | OperationError>;
/** Presentation only: no target reads, planning, or dependency decisions. */
export interface SetupPresentation {
  readonly choices: (
    category: "integrations" | "automation",
    options: readonly BundleInfo[],
    previous: readonly string[],
  ) => Question<readonly string[]>;
  readonly input: (declaration: DeclaredInput) => Question<Answer>;
  readonly manager: (
    question: Extract<ManagerResolution, { kind: "question" }>,
  ) => Question<PackageManager>;
  readonly confirm: (message: string) => Question<boolean>;
  readonly note: (message: string) => void;
  readonly plan: (plan: ChangePlan, dependencies: "required" | "not-required") => void;
  readonly progress: (message: string) => void;
  readonly complete: (report: ApplicationReport) => void;
}
export interface SetupOptions {
  readonly interactive: boolean;
  readonly projectRoot: string;
  readonly policyRoot: string;
  readonly presentation: SetupPresentation;
  /** Identity of the executing generator, not the target repository or a schema pin. */
  readonly commit?: string;
  /** The consequential external seam; production uses the native manager adapter. */
  readonly dependencies?: (target: TargetManager) => ApplicationDependencies;
}

/** Current policy definitions identify deselection, never a historical inventory. */
export function knownSelections(catalog: PolicyCatalog, previous?: SavedIntent): PolicySelections {
  const known = (category: "integrations" | "automation") =>
    (previous?.[category] ?? []).filter((id) =>
      catalog[category].some((bundle) => bundle.id === id),
    );
  return { integrations: known("integrations"), automation: known("automation") };
}

/** Shared planning path for terminal answers and explicit headless configuration. */
export function prepareSetupPlan(options: {
  readonly projectRoot: string;
  readonly policy: LoadedPolicy;
  readonly answers: unknown;
  readonly target: TargetManager;
  readonly previous: SavedIntent | undefined;
  readonly prior: ReturnType<typeof knownSelections>;
  readonly commit?: string;
}): Effect.Effect<ChangePlan, BundleError | PlanError> {
  return Effect.gen(function* () {
    const resolved = yield* resolveInputs(options.policy, options.answers, options.commit);
    const current = yield* loadPolicy(options.policy.root, options.prior);
    return yield* planProject(options.projectRoot, resolved, {
      ...(options.previous === undefined ? {} : { previous: options.previous }),
      currentBundles: current.bundles,
      manager: options.target.manager,
    });
  });
}

function chooseTargetManager(projectRoot: string, ui: SetupPresentation) {
  return Effect.gen(function* () {
    let manager = yield* resolveTargetManager(projectRoot);
    if (manager.kind === "question") {
      manager = yield* resolveTargetManager(projectRoot, yield* ui.manager(manager));
    }
    if (manager.kind !== "resolved") {
      return yield* new OperationError({
        detail: "Choose a supported target package manager and retry.",
      });
    }
    return manager.target;
  });
}

/** All discovery, questions and previews finish before applying the exact displayed plan. */
export function setup(
  options: SetupOptions,
): Effect.Effect<
  ApplicationReport | { readonly status: "declined" },
  Cancelled | OperationError | BundleError | PlanError | ApplicationError
> {
  return Effect.gen(function* () {
    if (!options.interactive) {
      return yield* new OperationError({
        detail:
          "its-checks requires an interactive terminal (stdin and stdout). For headless usage, use options, plan, or apply.",
      });
    }
    const ui = options.presentation;
    const previous = yield* loadPreviousIntent(options.projectRoot);
    const catalog = yield* discoverPolicy(options.policyRoot);
    const prior = knownSelections(catalog, previous);
    const retired = (["integrations", "automation"] as const).flatMap((category) =>
      (previous?.[category] ?? [])
        .filter((id) => !prior[category].includes(id))
        .map((id) => `${category}/${id}`),
    );
    if (retired.length > 0) {
      yield* Effect.sync(() =>
        ui.note(
          `Retired saved options: ${retired.join(", ")}. They cannot be selected; their answers will be dropped when saving. Historical setup cannot be identified: inspect and clean it up manually.`,
        ),
      );
    }
    const integrations = yield* ui.choices(
      "integrations",
      catalog.integrations,
      prior.integrations,
    );
    const automation = yield* ui.choices("automation", catalog.automation, prior.automation);
    const policy = yield* loadPolicy(options.policyRoot, { integrations, automation });
    const declarations = yield* enumerateInputs(policy, previous);
    const answers: Record<string, Record<string, Answer>> = {};
    for (const declaration of declarations) {
      (answers[declaration.bundle] ??= {})[declaration.input.id] = yield* ui.input(declaration);
    }
    const target = yield* chooseTargetManager(options.projectRoot, ui);
    const plan = yield* prepareSetupPlan({
      projectRoot: options.projectRoot,
      policy,
      answers,
      target,
      previous,
      prior,
      ...(options.commit === undefined ? {} : { commit: options.commit }),
    });
    const dependencies = (options.dependencies ?? createDependencyAdapter)(target);
    // Preview installation work without invoking the package manager.
    const preview = yield* dependencies.assess(plan);
    yield* Effect.sync(() => ui.plan(plan, preview));
    if (
      plan.requiresConfirmation &&
      !(yield* ui.confirm("Apply this plan, including replacements and removals?"))
    ) {
      return { status: "declined" as const };
    }
    yield* Effect.sync(() =>
      ui.progress("Applying approved configuration, then installing dependencies…"),
    );
    const report = yield* applyPlan(plan, { approved: true, dependencies });
    yield* Effect.sync(() => ui.complete(report));
    return report;
  });
}
