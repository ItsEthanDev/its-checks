import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect } from "effect";

import { loadPolicy, type PolicySelections } from "../src/bundles.ts";
import { resolveInputs, type ResolvedInputs } from "../src/inputs.ts";
import type { ChangePlan } from "../src/planning.ts";
import { defined, json } from "./assertions.ts";
import { fixture } from "./fixtures.ts";

const empty: PolicySelections = { integrations: [], automation: [] };
export const output = (plan: ChangePlan, relative: string): string => {
  const file = defined(plan.files.find((candidate) => candidate.path === relative));
  assert.equal(file.after.kind, "file");
  return Buffer.from(file.after.base64, "base64").toString("utf8");
};
export const value = (plan: ChangePlan, relative: string): ReturnType<typeof json> =>
  json(output(plan, relative));
export const changed = (plan: ChangePlan): string[][] =>
  plan.files.filter((file) => file.kind !== "noop").map((file) => [file.path, file.kind]);
export async function setup(t: Parameters<typeof fixture>[0]): Promise<
  Awaited<ReturnType<typeof fixture>> & {
    resolve: (selections?: PolicySelections) => Promise<ResolvedInputs>;
    writeProject: (relative: string, content: string | object) => Promise<void>;
  }
> {
  const f = await fixture(t);
  await f.add("base", { name: "TypeScript", devDependencies: { oxlint: "1.0.0" } });
  const resolve = async (selections = empty) =>
    await Effect.runPromise(
      resolveInputs(await Effect.runPromise(loadPolicy(f.policy, selections)), {}),
    );
  const writeProject = async (relative: string, content: string | object) => {
    const destination = path.join(f.project, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(
      destination,
      typeof content === "string" ? content : JSON.stringify(content),
    );
  };
  return { ...f, resolve, writeProject };
}
