import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { json, object } from "../../../../test/shared/assertions.ts";
import { planProject, type ChangePlan } from "../../planning/index.ts";
import {
  loadPolicy,
  resolveInputs,
  loadPreviousIntent,
  selectionFilename,
  type PolicySelections,
} from "../../policy/index.ts";
import { applyPlan, OperationError, type ApplicationDependencies } from "../index.ts";
import { noInstall, setup, failure, mtimes } from "./application-fixtures.ts";
const run = Effect.runPromise;
const empty: PolicySelections = ["base"];
await test("installation failure retains configuration but does not advance intent; retry completes intent", async (t) => {
  const f = await setup(t);
  let installed = false;
  let attempts = 0;
  const dependencies: ApplicationDependencies = {
    assess: () => Effect.succeed(installed ? "not-required" : "required"),
    install: (plan: ChangePlan) =>
      Effect.tryPromise({
        try: async () => {
          assert.equal(await run(loadPreviousIntent(f.project)), undefined);
          for (const file of plan.files) {
            if (file.after.kind === "file" && file.path !== selectionFilename) {
              assert.equal(
                (await fs.readFile(path.join(f.project, file.path))).toString("base64"),
                file.after.base64,
              );
            }
          }
          attempts++;
          if (attempts === 1) {
            throw Error("install failed, lockfile may be partial");
          }
          installed = true;
        },
        catch: (cause) => new OperationError({ detail: String(cause) }),
      }),
  };
  const error = await failure(applyPlan(await f.plan(), { approved: true, dependencies }));
  assert.equal(error.phase, "dependencies");
  assert.equal(error.report.dependencyWork, "required");
  assert.deepEqual(error.report.incomplete, [
    { kind: "install-dependencies", path: "package.json" },
    { kind: "write-file", path: selectionFilename },
  ]);
  const retry = await f.plan();
  assert.ok(
    retry.files
      .filter((file) => file.path !== selectionFilename)
      .every((file) => file.kind === "noop"),
  );
  const times = await mtimes(f.project);
  const report = await run(applyPlan(retry, { approved: true, dependencies }));
  assert.equal(report.dependencyWork, "completed");
  assert.equal(attempts, 2);
  const after = await mtimes(f.project);
  delete after[selectionFilename];
  assert.deepEqual(after, times);
  await run(applyPlan(await f.plan(), { approved: true, dependencies }));
  assert.equal(attempts, 2);
});
await test("configuration finishes but answers are not saved when dependency assessment fails", async (t) => {
  const f = await setup(t);
  await f.add("base", {
    name: "Base",
    inputs: [
      {
        id: "stylesheet",
        prompt: "Stylesheet",
        type: "path",
        destination: { file: ".oxfmtrc.json", field: ["sortTailwindcss", "stylesheet"] },
      },
    ],
  });
  await f.write("base/files/.oxfmtrc.json", {
    sortTailwindcss: { stylesheet: "authored.css" },
  });
  const policy = await run(
    loadPolicy(f.policy, empty, { repository: "example/fork", commit: "a".repeat(40) }),
  );
  const resolved = await run(
    resolveInputs(policy, { "example/fork:base": { stylesheet: "src/app.css" } }),
  );
  const plan = await run(planProject(f.project, resolved, { manager: "npm" }));
  const error = await failure(
    applyPlan(plan, {
      approved: true,
      dependencies: {
        ...noInstall,
        assess: () =>
          Effect.tryPromise({
            try: async () => {
              const intent = await run(loadPreviousIntent(f.project));
              assert.equal(intent, undefined);
              assert.equal(
                object(
                  json(await fs.readFile(path.join(f.project, ".oxfmtrc.json"), "utf8"))
                    .sortTailwindcss,
                ).stylesheet,
                "src/app.css",
              );
              throw Error("Cannot inspect installed state");
            },
            catch: (cause) => new OperationError({ detail: String(cause) }),
          }),
      },
    }),
  );
  assert.equal(error.phase, "dependencies");
  assert.equal(error.report.dependencyWork, "not-assessed");
  assert.deepEqual(error.report.failed, { kind: "assess-dependencies", path: "package.json" });
  assert.deepEqual(
    error.report.incomplete.map((entry) => entry.kind),
    ["assess-dependencies", "install-dependencies", "write-file"],
  );
});
