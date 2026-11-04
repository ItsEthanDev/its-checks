import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect } from "effect";

import { objects } from "../../../../test/shared/assertions.ts";
import { json } from "../../../../test/shared/assertions.ts";
import { fixture, snapshot } from "../../../../test/shared/fixtures.ts";
import { planProject, type PlanOptions, type ChangePlan } from "../../planning/index.ts";
import { loadPolicy, resolveInputs, type PolicySelections } from "../../policy/index.ts";
import type { applyPlan, ApplicationDependencies, ApplicationError } from "../index.ts";
/** Successful installation adapter without subprocess effects. */
export const noInstall: ApplicationDependencies = {
  install: () => Effect.void,
};
const empty: PolicySelections = ["base"];
export async function setup(t: Parameters<typeof fixture>[0]): Promise<
  Awaited<ReturnType<typeof fixture>> & {
    plan: (selections?: PolicySelections, options?: Partial<PlanOptions>) => Promise<ChangePlan>;
    put: (relative: string, content: string | object) => Promise<void>;
  }
> {
  const f = await fixture(t);
  await f.write("base/files/.oxfmtrc.json", "{}\n");
  const declarationFile = path.join(f.policy, "base/bundle.json");
  const declaration = json(await fs.readFile(declarationFile, "utf8"));
  const files = [];
  for (const file of objects(declaration.files)) {
    files.push({ ...file, operation: "replace" });
  }
  await fs.writeFile(declarationFile, JSON.stringify({ ...declaration, files }));
  const resolve = async (selections = empty) =>
    await Effect.runPromise(
      resolveInputs(
        await Effect.runPromise(
          loadPolicy(f.policy, selections, { repository: "example/fork", commit: "a".repeat(40) }),
        ),
        {},
      ),
    );
  const plan = async (selections = empty, options: Partial<PlanOptions> = {}) =>
    await Effect.runPromise(
      planProject(f.project, await resolve(selections), {
        manager: "npm",
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
