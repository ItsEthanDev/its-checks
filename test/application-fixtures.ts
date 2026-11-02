import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect } from "effect";

import type { applyPlan, ApplicationDependencies, ApplicationError } from "../src/application.ts";
import { loadPolicy, type PolicySelections } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject, type PlanOptions, type ChangePlan } from "../src/planning.ts";
import { createScriptPlanner } from "../src/scripts.ts";
import { fixture, snapshot } from "./fixtures.ts";

export const noInstall: ApplicationDependencies = {
  assess: () => Effect.succeed("not-required"),
  install: () => Effect.die("Unexpected install"),
};
const empty: PolicySelections = { integrations: [], automation: [] };
export async function setup(t: Parameters<typeof fixture>[0]): Promise<
  Awaited<ReturnType<typeof fixture>> & {
    plan: (selections?: PolicySelections, options?: PlanOptions) => Promise<ChangePlan>;
    put: (relative: string, content: string | object) => Promise<void>;
  }
> {
  const f = await fixture(t);
  const resolve = async (selections = empty) =>
    await Effect.runPromise(
      resolveInputs(await Effect.runPromise(loadPolicy(f.policy, selections)), {}),
    );
  const plan = async (selections = empty, options: PlanOptions = {}) =>
    await Effect.runPromise(
      planProject(f.project, await resolve(selections), {
        scripts: createScriptPlanner("npm"),
        ...options,
      }),
    );
  const put = async (relative: string, content: string | object) => {
    const destination = path.join(f.project, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(
      destination,
      typeof content === "string" ? content : JSON.stringify(content),
    );
  };
  return { ...f, plan, put };
}
export async function failure(effect: ReturnType<typeof applyPlan>): Promise<ApplicationError> {
  return await Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (error) => error,
        onSuccess: () => {
          throw Error("Expected application failure");
        },
      }),
    ),
  );
}
export async function mtimes(project: string): Promise<Record<string, bigint>> {
  const entries = await snapshot(project);
  return Object.fromEntries(
    await Promise.all(
      Object.keys(entries).map(
        async (relative) =>
          [
            relative,
            (await fs.stat(path.join(project, relative), { bigint: true })).mtimeNs,
          ] as const,
      ),
    ),
  );
}
