import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { defined } from "../../../../test/shared/assertions.ts";
import { fixture, revision, snapshot } from "../../../../test/shared/fixtures.ts";
import { loadPreviousIntent, type SourceStore } from "../../policy/index.ts";
import { Cancelled, setup } from "../index.ts";
import { dialogue, ready } from "./workflow-fixtures.ts";
const run = Effect.runPromise;
await test("first use does not select an implicit policy", async (t) => {
  const f = await fixture(t);
  const d = dialogue();
  const before = await snapshot(f.project);
  const report = await run(
    setup({
      interactive: true,
      projectRoot: f.project,
      presentation: d.ui,
      sources: f.store,
      dependencies: () => ready,
    }),
  );
  assert.equal(report.status, "no-sources");
  assert.deepEqual(await snapshot(f.project), before);
  assert.match(defined(d.notes[0]), /add owner\/repo/);
});
await test("add preserves other sources, reruns stay pinned, and removal uses the same combined plan", async (t) => {
  const f = await fixture(t);
  let tip = revision.commit;
  const fetched: string[] = [];
  const store: SourceStore = {
    resolve: (repository, commit) => {
      fetched.push(`${repository}@${commit ?? "latest"}`);
      return Effect.succeed({
        repository: repository.toLowerCase(),
        commit: commit ?? tip,
        root: f.policy,
      });
    },
  };
  const perform = async (
    command?: "add" | "update" | "remove",
    repository?: string,
    approve = true,
  ) => {
    const d = dialogue({
      selections: { "example/fork": ["base"], "other/policy": ["base"] },
      approve,
    });
    const report = await run(
      setup({
        interactive: true,
        projectRoot: f.project,
        presentation: d.ui,
        sources: store,
        dependencies: () => ready,
        ...(command === undefined ? {} : { command }),
        ...(repository === undefined ? {} : { repository }),
      }),
    );
    return { report, d };
  };
  await perform("add", "Example/Fork");
  await perform("add", "other/policy");
  assert.equal((await run(loadPreviousIntent(f.project)))?.sources.length, 2);
  fetched.length = 0;
  tip = "b".repeat(40);
  await perform();
  assert.ok(fetched.every((entry) => !entry.endsWith("latest")));
  await perform("update", "example/fork");
  let state = await run(loadPreviousIntent(f.project));
  assert.equal(state?.sources.find((source) => source.repository === "example/fork")?.commit, tip);
  assert.equal(
    state?.sources.find((source) => source.repository === "other/policy")?.commit,
    revision.commit,
  );
  const before = await snapshot(f.project);
  await perform("remove", "example/fork", false);
  assert.deepEqual(await snapshot(f.project), before);
  await perform("remove", "example/fork");
  state = await run(loadPreviousIntent(f.project));
  assert.deepEqual(
    state?.sources.map((source) => source.repository),
    ["other/policy"],
  );
});
await test("hidden dependency inclusion is explained and deselecting its explicit checkbox retains it", async (t) => {
  const f = await fixture(t);
  await f.add("shared", { name: "Shared", hidden: true, requires: [] });
  await f.add("top", { name: "Top", requires: ["shared"] });
  const d = dialogue({ selections: { "example/fork": ["top"] } });
  await run(
    setup({
      interactive: true,
      projectRoot: f.project,
      command: "add",
      repository: "example/fork",
      sources: f.store,
      presentation: d.ui,
      dependencies: () => ready,
    }),
  );
  assert.equal(d.shown[0]?.ids.includes("shared"), false);
  assert.ok(d.notes.some((note) => /shared.*required by.*top/.test(note)));
  assert.deepEqual((await run(loadPreviousIntent(f.project)))?.sources[0]?.bundles, ["top"]);
});
await test("cancellation, declined plans, and noninteractive misuse make no project changes", async (t) => {
  const f = await fixture(t);
  const before = await snapshot(f.project);
  const d = dialogue({ approve: false });
  const options = {
    interactive: true,
    projectRoot: f.project,
    command: "add" as const,
    repository: "example/fork",
    sources: f.store,
    presentation: d.ui,
    dependencies: () => ready,
  };
  assert.equal((await run(setup(options))).status, "declined");
  await assert.rejects(run(setup({ ...options, interactive: false })), /terminal/);
  await assert.rejects(
    run(
      setup({ ...options, presentation: { ...d.ui, choices: () => Effect.fail(new Cancelled()) } }),
    ),
  );
  assert.deepEqual(await snapshot(f.project), before);
});
await test("a failed install leaves saved revisions unchanged", async (t) => {
  const f = await fixture(t);
  const d = dialogue({ selections: { "example/fork": ["base"] } });
  const options = {
    interactive: true,
    projectRoot: f.project,
    command: "add" as const,
    repository: "example/fork",
    sources: f.store,
    presentation: d.ui,
    dependencies: () => ready,
  };
  await run(setup(options));
  const prior = await fs.readFile(path.join(f.project, ".its-checks.json"), "utf8");
  const store: SourceStore = {
    resolve: (repository, commit) =>
      Effect.succeed({ repository, commit: commit ?? "b".repeat(40), root: f.policy }),
  };
  const { OperationError } = await import("../../application/index.ts");
  await assert.rejects(
    run(
      setup({
        ...options,
        command: "update",
        sources: store,
        dependencies: () => ({
          install: () => Effect.fail(new OperationError({ detail: "install failed" })),
        }),
      }),
    ),
    /install failed/,
  );
  assert.equal(await fs.readFile(path.join(f.project, ".its-checks.json"), "utf8"), prior);
});
await test("updates retain valid explicit selections and saved answers without reopening the picker", async (t) => {
  const f = await fixture(t);
  await f.add("extra", {
    name: "Extra",
    inputs: [
      {
        id: "label",
        prompt: "Label?",
        type: "string",
        destination: { file: "config.json", field: ["label"] },
      },
    ],
  });
  await f.write("extra/files/config.json", { label: "authored" });
  const first = dialogue({
    selections: { "example/fork": ["extra"] },
    answers: { "example/fork:extra/label": "saved" },
  });
  const options = {
    interactive: true,
    projectRoot: f.project,
    sources: f.store,
    presentation: first.ui,
    dependencies: () => ready,
  };
  await run(setup({ ...options, command: "add", repository: "example/fork" }));
  const next = dialogue();
  const sources: SourceStore = {
    resolve: (repository, commit) =>
      Effect.succeed({ repository, commit: commit ?? "b".repeat(40), root: f.policy }),
  };
  await run(setup({ ...options, command: "update", presentation: next.ui, sources }));
  assert.deepEqual(next.shown, []);
  assert.deepEqual(next.questions, []);
  const saved = await run(loadPreviousIntent(f.project));
  assert.deepEqual(saved?.sources[0]?.bundles, ["extra"]);
  assert.deepEqual(saved?.sources[0]?.answers, { extra: { label: "saved" } });
});
await test("an update cannot silently drop a selected bundle that becomes dependency-only", async (t) => {
  const f = await fixture(t);
  await f.add("extra", { name: "Extra" });
  const first = dialogue({ selections: { "example/fork": ["extra"] } });
  const options = {
    interactive: true,
    projectRoot: f.project,
    sources: f.store,
    presentation: first.ui,
    dependencies: () => ready,
  };
  await run(setup({ ...options, command: "add", repository: "example/fork" }));
  const nextRoot = path.join(f.root, "next-policy");
  await fs.cp(f.policy, nextRoot, { recursive: true });
  const declaration = path.join(nextRoot, "extra/bundle.json");
  await fs.writeFile(
    declaration,
    JSON.stringify({ name: "Extra", description: "Now dependency-only", hidden: true }),
  );
  const sources: SourceStore = {
    resolve: (repository, commit) =>
      Effect.succeed({
        repository,
        commit: commit ?? "b".repeat(40),
        root: commit === revision.commit ? f.policy : nextRoot,
      }),
  };
  const before = await snapshot(f.project);
  const declined = dialogue({ selections: { "example/fork": ["base"] }, approve: false });
  assert.equal(
    (await run(setup({ ...options, command: "update", sources, presentation: declined.ui })))
      .status,
    "declined",
  );
  assert.deepEqual(await snapshot(f.project), before);
  assert.ok(declined.notes.some((note) => /extra.*Revise selections/.test(note)));
  const accepted = dialogue({ selections: { "example/fork": ["base"] } });
  await run(setup({ ...options, command: "update", sources, presentation: accepted.ui }));
  assert.deepEqual((await run(loadPreviousIntent(f.project)))?.sources[0]?.bundles, ["base"]);
});
