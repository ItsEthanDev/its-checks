import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseArgs } from "node:util";

import { Effect, Schema } from "effect";

import { applyPlan, OperationError, type ApplicationError } from "./application.ts";
import { discoverPolicy, loadPolicy, type BundleError } from "./bundles.ts";
import {
  createDependencyAdapter,
  managerLockfiles,
  resolveTargetManager,
} from "./package-managers.ts";
import type { PlanError } from "./plan-errors.ts";
import { Answers, loadPreviousIntent } from "./selections.ts";
import { executingCommit } from "./source-revision.ts";
import { assertTargetUnchanged, readTargetSnapshot } from "./target-snapshot.ts";
import { knownSelections, prepareSetupPlan } from "./workflow.ts";

const Manager = Schema.Literals(["npm", "pnpm", "yarn", "bun"]);
const Config = Schema.Struct({
  integrations: Schema.Array(Schema.String),
  automation: Schema.Array(Schema.String),
  answers: Answers,
  packageManager: Schema.optionalKey(Manager),
  // Saved intent can be supplied directly; provenance is regenerated, not trusted as an execution pin.
  $schema: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.String),
  commit: Schema.optionalKey(Schema.String),
});
const FileState = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("absent") }),
  Schema.Struct({ kind: Schema.Literal("file"), base64: Schema.String, mode: Schema.Finite }),
]);
const Kind = Schema.Literals(["creation", "addition", "replacement", "removal", "noop"]);
const SavedPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generator: Schema.String,
  manager: Manager,
  plan: Schema.Struct({
    snapshot: Schema.Struct({
      root: Schema.String,
      files: Schema.Record(Schema.String, FileState),
    }),
    files: Schema.Array(
      Schema.Struct({
        path: Schema.String,
        before: FileState,
        after: FileState,
        kind: Kind,
        conflict: Schema.Boolean,
        reasons: Schema.Array(Schema.String),
      }),
    ),
    packageEntries: Schema.Array(
      Schema.Struct({
        section: Schema.Literals(["dependencies", "devDependencies", "scripts"]),
        name: Schema.String,
        before: Schema.NullOr(Schema.String),
        after: Schema.NullOr(Schema.String),
        kind: Kind,
        conflict: Schema.Boolean,
      }),
    ),
    requiresConfirmation: Schema.Boolean,
    complete: Schema.Boolean,
    deferred: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
  }),
});
const io = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new OperationError({ detail: cause instanceof Error ? cause.message : String(cause) }),
  });
const fail = (detail: string) => new OperationError({ detail });
const readJson = <S extends Schema.Top & { readonly DecodingServices: never }>(
  file: string,
  schema: S,
) =>
  io(() => fs.readFile(file, "utf8")).pipe(
    Effect.flatMap((text) =>
      Schema.decodeEffect(Schema.fromJsonString(schema), {
        onExcessProperty: "error",
      })(text),
    ),
    Effect.mapError((cause) => fail(`${file}: ${cause.message}`)),
  );

/** Content identity works for local edits and installed archives without Git metadata. */
function fingerprint(packageRoot: string) {
  return io(async () => {
    const hash = createHash("sha256");
    async function visit(relative: string): Promise<void> {
      const absolute = path.join(packageRoot, relative);
      const stat = await fs.lstat(absolute);
      if (stat.isDirectory()) {
        for (const name of (await fs.readdir(absolute)).toSorted()) {
          await visit(`${relative}/${name}`);
        }
      } else if (stat.isFile()) {
        hash.update(JSON.stringify([relative, stat.mode & 0o777]));
        hash.update(await fs.readFile(absolute));
        hash.update("\0");
      } else {
        throw new Error(`Unsupported generator file: ${relative}`);
      }
    }
    for (const relative of ["package.json", "bin", "src", "policy"]) {
      await visit(relative);
    }
    return hash.digest("hex");
  });
}

/** Noninteractive command surface. stdout is one JSON result when --json is supplied. */
export function headless(
  args: readonly string[],
  projectRoot: string,
  packageRoot: string,
): Effect.Effect<
  { readonly json: boolean; readonly result: unknown; readonly text?: string },
  OperationError | BundleError | PlanError | ApplicationError
> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () =>
        parseArgs({
          args: [...args],
          allowPositionals: true,
          strict: true,
          options: {
            json: { type: "boolean" },
            config: { type: "string" },
            out: { type: "string" },
          },
        }),
      catch: (cause) => fail(String(cause)),
    });
    const { values, positionals } = parsed;
    const [command, planFile] = positionals;
    const policyRoot = path.join(packageRoot, "policy");
    switch (command) {
      case "options":
        if (positionals.length === 1 && withoutPlanOptions(values)) {
          return { json: values.json === true, result: yield* describeOptions(policyRoot) };
        }
        break;
      case "plan":
        if (positionals.length === 1 && values.config !== undefined && values.out !== undefined) {
          const result = yield* savePlan({
            projectRoot,
            packageRoot,
            configFile: values.config,
            out: values.out,
          });
          return { json: values.json === true, ...result };
        }
        break;
      case "apply":
        if (positionals.length === 2 && planFile !== undefined && withoutPlanOptions(values)) {
          const report = yield* applySavedPlan(path.resolve(projectRoot, planFile), packageRoot);
          return {
            json: values.json === true,
            result: report,
            text: `Completed: ${report.completed.length} operations; dependencies ${report.dependencyWork}.`,
          };
        }
        break;
      case undefined:
      default:
        break;
    }
    return yield* fail(
      "Usage: its-checks options [--json] | plan --config <file> --out <new-file> [--json] | apply <plan-file> [--json]",
    );
  });
}

function withoutPlanOptions(values: { config?: string; out?: string }) {
  return values.config === undefined && values.out === undefined;
}

function describeOptions(policyRoot: string) {
  return Effect.gen(function* () {
    const catalog = yield* discoverPolicy(policyRoot);
    const describe = (bundle: typeof catalog.baseline) => ({
      id: bundle.id,
      key: bundle.key,
      name: bundle.declaration.name,
      ...(bundle.declaration.description === undefined
        ? {}
        : { description: bundle.declaration.description }),
      inputs: bundle.declaration.inputs ?? [],
    });
    const result = {
      base: describe(catalog.baseline),
      integrations: catalog.integrations.map(describe),
      automation: catalog.automation.map(describe),
    };
    return result;
  });
}

function savePlan(options: {
  projectRoot: string;
  packageRoot: string;
  configFile: string;
  out: string;
}) {
  return Effect.gen(function* () {
    const { projectRoot, packageRoot } = options;
    const policyRoot = path.join(packageRoot, "policy");
    const config = yield* readJson(path.resolve(projectRoot, options.configFile), Config);
    const previous = yield* loadPreviousIntent(projectRoot);
    const catalog = yield* discoverPolicy(policyRoot);
    const policy = yield* loadPolicy(policyRoot, config);
    const resolution = yield* resolveTargetManager(projectRoot, config.packageManager);
    if (resolution.kind === "question") {
      return yield* fail(
        `${resolution.reason} Set packageManager in the config to one of: ${resolution.choices.join(", ")}. Evidence: ${resolution.evidence.length === 0 ? "none" : resolution.evidence.join(", ")}`,
      );
    }
    const commit = yield* executingCommit(packageRoot);
    const plan = yield* prepareSetupPlan({
      projectRoot,
      policy,
      answers: config.answers,
      target: resolution.target,
      previous,
      prior: knownSelections(catalog, previous),
      ...(commit === undefined ? {} : { commit }),
    });
    const evidence = yield* readTargetSnapshot(projectRoot, managerLockfiles);
    const saved: typeof SavedPlan.Type = {
      schemaVersion: 1,
      generator: yield* fingerprint(packageRoot),
      manager: resolution.target.manager,
      plan: {
        ...plan,
        snapshot: {
          root: plan.snapshot.root,
          files: { ...evidence.files, ...plan.snapshot.files },
        },
      },
    };
    const output = yield* writeSavedPlan(saved, path.resolve(projectRoot, options.out));
    return { result: saved, text: describePlan(saved, output) };
  });
}

function writeSavedPlan(saved: typeof SavedPlan.Type, requested: string) {
  return Effect.gen(function* () {
    const output = path.join(
      yield* io(() => fs.realpath(path.dirname(requested))),
      path.basename(requested),
    );
    if (
      Object.keys(saved.plan.snapshot.files).some((relative) => {
        const target = path.join(saved.plan.snapshot.root, relative);
        return (
          output === target ||
          output.startsWith(`${target}${path.sep}`) ||
          target.startsWith(`${output}${path.sep}`)
        );
      })
    ) {
      return yield* fail(
        "Plan output must not overlap a target configuration or package-manager file",
      );
    }
    yield* assertTargetUnchanged(saved.plan.snapshot);
    // Never truncate an existing config, project file, or previously approved plan.
    yield* io(() =>
      fs.writeFile(output, `${JSON.stringify(saved, null, 2)}\n`, { flag: "wx", mode: 0o600 }),
    );
    return output;
  });
}

function describePlan(saved: typeof SavedPlan.Type, output: string) {
  const { plan } = saved;
  return [
    `Target: ${plan.snapshot.root}`,
    `Package manager: ${saved.manager}`,
    ...plan.files
      .filter((file) => file.kind !== "noop")
      .map((file) => `${file.kind}: ${file.path}${file.conflict ? " [conflict]" : ""}`),
    ...plan.packageEntries
      .filter((entry) => entry.kind !== "noop")
      .map(
        (entry) =>
          `${entry.kind}: ${entry.section}.${entry.name}: ${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}`,
      ),
    `After applying: ${saved.manager} install (including lifecycle scripts)`,
    `Plan saved: ${output}`,
    "No project configuration changed; no installation performed.",
  ].join("\n");
}

function applySavedPlan(planFile: string, packageRoot: string) {
  return Effect.gen(function* () {
    const saved = yield* readJson(planFile, SavedPlan);
    if (!path.isAbsolute(saved.plan.snapshot.root)) {
      return yield* fail("Plan target must be an absolute path");
    }
    if (saved.generator !== (yield* fingerprint(packageRoot))) {
      return yield* fail(
        "Generator changed since planning; use the same generator or build a fresh plan",
      );
    }
    yield* assertTargetUnchanged(saved.plan.snapshot);
    const resolution = yield* resolveTargetManager(saved.plan.snapshot.root, saved.manager);
    if (resolution.kind !== "resolved") {
      return yield* fail("Cannot resolve saved package manager");
    }
    const report = yield* applyPlan(saved.plan, {
      approved: true,
      dependencies: createDependencyAdapter(resolution.target),
    });
    return report;
  });
}
