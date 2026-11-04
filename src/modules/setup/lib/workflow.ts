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
import { compare } from "../../policy/documents.ts";
import {
  createSourceStore,
  discoverPolicy,
  loadPolicy,
  enumerateInputs,
  resolveInputs,
  loadPreviousIntent,
  qualifiedAnswers,
  repositoryIdentity,
  validateSources,
  type SourceStore,
  type SourceConfig,
  type BundleError,
  type BundleInfo,
  type LoadedPolicy,
  type DeclaredInput,
  type Answer,
  type SavedIntent,
} from "../../policy/index.ts";
export class Cancelled extends Schema.TaggedError<
  Cancelled,
  {
    readonly brand: unique symbol;
  }
>()("Cancelled", {}) {}
export type Question<A> = Effect.Effect<A, Cancelled | OperationError>;
export interface SetupPresentation {
  readonly choices: (
    source: string,
    options: readonly BundleInfo[],
    previous: readonly string[],
  ) => Question<readonly string[]>;
  readonly input: (declaration: DeclaredInput) => Question<Answer>;
  readonly manager: (
    question: Extract<
      ManagerResolution,
      {
        kind: "question";
      }
    >,
  ) => Question<PackageManager>;
  readonly confirm: (message: string) => Question<boolean>;
  readonly note: (message: string) => void;
  readonly plan: (plan: ChangePlan) => void;
  readonly progress: (message: string) => void;
  readonly complete: (report: ApplicationReport) => void;
}
export interface SetupOptions {
  readonly interactive: boolean;
  readonly projectRoot: string;
  readonly presentation: SetupPresentation;
  readonly command?: "add" | "update" | "remove";
  readonly repository?: string;
  readonly sources?: SourceStore;
  readonly dependencies?: (target: TargetManager) => ApplicationDependencies;
}
export function loadSources(
  configs: readonly SourceConfig[],
  store: SourceStore,
): Effect.Effect<LoadedPolicy, BundleError> {
  return Effect.gen(function* () {
    yield* validateSources(configs);
    const policies: LoadedPolicy[] = [];
    for (const config of configs.toSorted((a, b) => compare(a.repository, b.repository))) {
      const source = yield* store.resolve(config.repository, config.commit);
      policies.push(yield* loadPolicy(source.root, config.bundles, source));
    }
    return {
      root: policies[0]?.root ?? "",
      sources: policies.flatMap((policy) => policy.sources),
      bundles: policies.flatMap((policy) => policy.bundles),
    };
  });
}
/** Previous pinned declarations identify cleanup, not historical output baselines. */
export function prepareSetupPlan(options: {
  readonly projectRoot: string;
  readonly policy: LoadedPolicy;
  readonly answers: unknown;
  readonly target: TargetManager;
  readonly previous: SavedIntent | undefined;
  readonly sources: SourceStore;
}): Effect.Effect<ChangePlan, BundleError | PlanError> {
  return Effect.gen(function* () {
    const resolved = yield* resolveInputs(options.policy, options.answers);
    let previousBundles: LoadedPolicy["bundles"] = [];
    if (options.previous !== undefined) {
      const prior = yield* loadSources(options.previous.sources, options.sources);
      previousBundles = (yield* resolveInputs(prior, qualifiedAnswers(options.previous.sources)))
        .policy.bundles;
    }
    return yield* planProject(options.projectRoot, resolved, {
      manager: options.target.manager,
      previousBundles,
    });
  });
}
function changeSources(
  configs: readonly SourceConfig[],
  options: SetupOptions,
  store: SourceStore,
) {
  return Effect.gen(function* () {
    const { command } = options;
    if (command === undefined) {
      return [...configs];
    }
    const repository =
      options.repository === undefined
        ? undefined
        : yield* Effect.try({
            try: () => repositoryIdentity(options.repository ?? ""),
            catch: (cause) => new OperationError({ detail: String(cause) }),
          });
    if (command === "add") {
      if (repository === undefined) {
        return yield* new OperationError({ detail: "add requires owner/repo" });
      }
      if (configs.some((source) => source.repository === repository)) {
        return [...configs];
      }
      const source = yield* store.resolve(repository);
      return [
        ...configs,
        { repository: source.repository, commit: source.commit, bundles: [], answers: {} },
      ];
    }
    if (repository !== undefined && !configs.some((source) => source.repository === repository)) {
      return yield* new OperationError({ detail: `Source ${repository} is not configured` });
    }
    if (command === "remove") {
      if (repository === undefined) {
        return yield* new OperationError({ detail: "remove requires owner/repo" });
      }
      return configs.filter((source) => source.repository !== repository);
    }
    return yield* Effect.forEach(configs, (config) => {
      if (repository !== undefined && config.repository !== repository) {
        return Effect.succeed(config);
      }
      return store
        .resolve(config.repository)
        .pipe(Effect.map((source) => ({ ...config, commit: source.commit })));
    });
  });
}
function pickSource(
  config: SourceConfig,
  ui: SetupPresentation,
  store: SourceStore,
  repairOnly: boolean,
) {
  return Effect.gen(function* () {
    const source = yield* store.resolve(config.repository, config.commit);
    const catalog = yield* discoverPolicy(source.root, source.repository);
    const visible = catalog.bundles.filter((bundle) => bundle.declaration.hidden !== true);
    const retired = config.bundles.filter((id) => !visible.some((bundle) => bundle.id === id));
    if (repairOnly && retired.length === 0) {
      return config;
    }
    if (retired.length > 0) {
      ui.note(
        `${config.repository}: saved selections are missing or dependency-only: ${retired.join(", ")}. Revise selections explicitly before proceeding.`,
      );
    }
    const bundles = yield* ui.choices(
      config.repository,
      visible,
      config.bundles.filter((id) => !retired.includes(id)),
    );
    if (
      retired.length > 0 &&
      !(yield* ui.confirm(
        `Replace retired explicit selections ${retired.join(", ")} with the displayed choices?`,
      ))
    ) {
      return undefined;
    }
    return { ...config, bundles };
  });
}
function pickSources(configs: readonly SourceConfig[], options: SetupOptions, store: SourceStore) {
  return Effect.gen(function* () {
    const result: SourceConfig[] = [];
    const repository = options.repository?.toLowerCase();
    for (const config of configs) {
      const targeted =
        options.command === "add" || (options.command === "update" && repository !== undefined);
      if (options.command === "remove" || (targeted && config.repository !== repository)) {
        result.push(config);
        continue;
      }
      const next = yield* pickSource(
        config,
        options.presentation,
        store,
        options.command === "update",
      );
      if (next === undefined) {
        return undefined;
      }
      result.push(next);
    }
    return result;
  });
}
function explainDependencies(policy: LoadedPolicy, ui: SetupPresentation) {
  for (const bundle of policy.bundles) {
    const explicit =
      policy.sources
        .find((source) => source.repository === bundle.repository)
        ?.bundles.includes(bundle.id) === true;
    if (explicit) {
      continue;
    }
    const requiredBy = policy.bundles
      .filter(
        (other) =>
          other.repository === bundle.repository &&
          other.declaration.requires?.includes(bundle.id) === true,
      )
      .map((other) => other.key);
    ui.note(`Included dependency ${bundle.key}; required by ${requiredBy.join(", ")}`);
  }
}
function collectAnswers(
  policy: LoadedPolicy,
  previous: SavedIntent | undefined,
  options: SetupOptions,
) {
  return Effect.gen(function* () {
    const saved = qualifiedAnswers(previous?.sources ?? []);
    const answers: Record<string, Record<string, Answer>> = {};
    for (const declaration of yield* enumerateInputs(policy, previous)) {
      const editable =
        options.command === undefined ||
        (options.command === "add" &&
          declaration.bundle.startsWith(`${options.repository?.toLowerCase() ?? ""}:`));
      const prior = saved[declaration.bundle]?.[declaration.input.id];
      const value =
        !editable && prior !== undefined && prior === declaration.initialValue
          ? prior
          : yield* options.presentation.input(declaration);
      (answers[declaration.bundle] ??= {})[declaration.input.id] = value;
    }
    return answers;
  });
}
function chooseManager(projectRoot: string, ui: SetupPresentation) {
  return Effect.gen(function* () {
    let manager = yield* resolveTargetManager(projectRoot);
    if (manager.kind === "question") {
      manager = yield* resolveTargetManager(projectRoot, yield* ui.manager(manager));
    }
    if (manager.kind !== "resolved") {
      return yield* new OperationError({ detail: "Choose a supported package manager" });
    }
    return manager.target;
  });
}
export function setup(options: SetupOptions): Effect.Effect<
  | ApplicationReport
  | {
      readonly status: "declined" | "no-sources";
    },
  Cancelled | OperationError | BundleError | PlanError | ApplicationError
> {
  return Effect.gen(function* () {
    if (!options.interactive) {
      return yield* new OperationError({
        detail:
          "Interactive commands require a terminal. For headless usage, use options, plan, or apply.",
      });
    }
    const ui = options.presentation;
    const store = options.sources ?? createSourceStore();
    const previous = yield* loadPreviousIntent(options.projectRoot);
    const proposed = yield* changeSources(previous?.sources ?? [], options, store);
    if (proposed.length === 0 && options.command !== "remove") {
      ui.note("No policy sources configured. Run: its-checks add owner/repo");
      return { status: "no-sources" as const };
    }
    const configs = yield* pickSources(proposed, options, store);
    if (configs === undefined) {
      return { status: "declined" as const };
    }
    const policy = yield* loadSources(configs, store);
    explainDependencies(policy, ui);
    const answers = yield* collectAnswers(policy, previous, options);
    const target = yield* chooseManager(options.projectRoot, ui);
    const plan = yield* prepareSetupPlan({
      projectRoot: options.projectRoot,
      policy,
      answers,
      target,
      previous,
      sources: store,
    });
    const dependencies = (options.dependencies ?? createDependencyAdapter)(target);
    ui.plan(plan);
    if (
      !(yield* ui.confirm(
        "Apply this plan, then run the package manager's install (including lifecycle scripts)?",
      ))
    ) {
      return { status: "declined" as const };
    }
    ui.progress("Applying approved configuration, then installing dependencies…");
    const report = yield* applyPlan(plan, { approved: true, dependencies });
    ui.complete(report);
    return report;
  });
}
