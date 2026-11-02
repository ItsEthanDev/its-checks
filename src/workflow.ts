import { Data, Effect } from "effect";

import {
  applyPlan,
  type ApplicationDependencies,
  type ApplicationReport,
  OperationError,
} from "./application.ts";
import type { BundleInfo } from "./bundle-types.ts";
import { discoverPolicy, loadPolicy } from "./bundles.ts";
import { enumerateInputs, resolveInputs, type DeclaredInput } from "./inputs.ts";
import {
  createDependencyAdapter,
  resolveTargetManager,
  type ManagerResolution,
  type TargetManager,
} from "./package-managers.ts";
import { planProject, type ChangePlan } from "./planning.ts";
import type { PackageManager } from "./scripts.ts";
import { loadPreviousIntent, type Answer } from "./selections.ts";

export class Cancelled extends Data.TaggedError("Cancelled") {}
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
  readonly confirm: () => Question<boolean>;
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

/** All discovery, questions and previews finish before applying the exact displayed plan. */
export function setup(options: SetupOptions) {
  return Effect.gen(function* () {
    if (!options.interactive)
      {return yield* Effect.fail(
        new OperationError({
          detail:
            "its-checks requires an interactive terminal (stdin and stdout). Run it directly from the target package in a terminal; unattended flags are not supported.",
        }),
      );}
    const ui = options.presentation;
    const previous = yield* loadPreviousIntent(options.projectRoot);
    const catalog = yield* discoverPolicy(options.policyRoot);
    const known = (category: "integrations" | "automation") =>
      (previous?.[category] ?? []).filter((id) =>
        catalog[category].some((bundle) => bundle.id === id),
      );
    const prior = { integrations: known("integrations"), automation: known("automation") };
    const retired = (["integrations", "automation"] as const).flatMap((category) =>
      (previous?.[category] ?? [])
        .filter((id) => !prior[category].includes(id))
        .map((id) => `${category}/${id}`),
    );
    if (retired.length)
      {yield* Effect.sync(() =>
        ui.note(
          `Retired saved options: ${retired.join(", ")}. They cannot be selected; their answers will be dropped when saving. Historical setup cannot be identified: inspect and clean it up manually.`,
        ),
      );}
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
    const resolved = yield* resolveInputs(policy, answers, options.commit);
    let manager = yield* resolveTargetManager(options.projectRoot);
    if (manager.kind === "question")
      {manager = yield* resolveTargetManager(options.projectRoot, yield* ui.manager(manager));}
    if (manager.kind !== "resolved")
      {return yield* Effect.fail(
        new OperationError({ detail: "Choose a supported target package manager and retry." }),
      );}
    // Current definitions of old selections identify deselection, never a historical inventory.
    const current = yield* loadPolicy(options.policyRoot, prior);
    const plan = yield* planProject(options.projectRoot, resolved, {
      ...(previous === undefined ? {} : { previous }),
      currentBundles: current.bundles,
      scripts: manager.target.scripts,
    });
    const dependencies = (options.dependencies ?? createDependencyAdapter)(manager.target);
    // Preview installation work without invoking the package manager.
    const preview = yield* dependencies.assess(plan);
    yield* Effect.sync(() => ui.plan(plan, preview));
    if (plan.requiresConfirmation && !(yield* ui.confirm())) {return { status: "declined" as const };}
    yield* Effect.sync(() =>
      ui.progress("Applying approved configuration, then installing dependencies…"),
    );
    const report = yield* applyPlan(plan, { approved: true, dependencies });
    yield* Effect.sync(() => ui.complete(report));
    return report;
  });
}
