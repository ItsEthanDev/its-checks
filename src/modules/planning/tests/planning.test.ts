import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { json } from "../../../../test/shared/assertions.ts";
import { manifest, defined } from "../../../../test/shared/assertions.ts";
import { fixture, revision, snapshot } from "../../../../test/shared/fixtures.ts";
import { applyPlan } from "../../application/index.ts";
import { loadPolicy, resolveInputs, type LoadedPolicy } from "../../policy/index.ts";
import { planProject, type ChangePlan } from "../index.ts";
const run = Effect.runPromise;
const dependencies = {
  install: () => Effect.void,
};
const content = (artifact: ChangePlan, relative: string) => {
  const file = artifact.files.find((candidate) => candidate.path === relative)?.after;
  assert.ok(file?.kind === "file");
  return Buffer.from(file.base64, "base64").toString();
};
const apply = (artifact: ChangePlan) => run(applyPlan(artifact, { approved: true, dependencies }));
async function plan(project: string, policy: LoadedPolicy, prior?: LoadedPolicy) {
  return await run(
    planProject(project, await run(resolveInputs(policy, {})), {
      manager: "npm",
      previousBundles: prior?.bundles ?? [],
    }),
  );
}
await test("seed, compose, replace and removal respect declared ownership and preserve unrelated data", async (t) => {
  const f = await fixture(t);
  await f.add("docs", {
    name: "Docs",
    requires: [],
    files: [
      { source: "files/readme.md", target: "docs/guide.md", operation: "seed" },
      {
        source: "files/config.json",
        target: "config.json",
        operation: "compose",
        format: "json",
        fields: { "/ignore": { merge: "append-unique" } },
      },
      { source: "files/workflow.yml", target: ".github/workflows/check.yml", operation: "replace" },
    ],
  });
  await fs.mkdir(path.join(f.policy, "docs/files"));
  await fs.writeFile(path.join(f.policy, "docs/files/readme.md"), "starter\n");
  await fs.writeFile(
    path.join(f.policy, "docs/files/config.json"),
    '{"rules":{"managed":"error"},"ignore":["dist"]}',
  );
  await fs.writeFile(path.join(f.policy, "docs/files/workflow.yml"), "name: quality\n");
  await fs.writeFile(
    path.join(f.project, "config.json"),
    '{"rules":{"unrelated":true,"managed":"off"},"ignore":["local"]}',
  );
  const loaded = await f.load(["docs"]);
  const before = await snapshot(f.project);
  const initial = await plan(f.project, loaded);
  assert.deepEqual(await snapshot(f.project), before);
  assert.deepEqual(json(content(initial, "config.json")), {
    ignore: ["local", "dist"],
    rules: { managed: "error", unrelated: true },
  });
  await apply(initial);
  await fs.writeFile(path.join(f.project, "docs/guide.md"), "project-owned\n");
  const rerun = await plan(f.project, loaded, loaded);
  assert.ok(rerun.files.every((file) => file.kind === "noop"));
  const cleanup = await plan(f.project, await f.load([]), loaded);
  assert.equal(
    cleanup.files.find((file) => file.path === ".github/workflows/check.yml")?.kind,
    "removal",
  );
  await apply(cleanup);
  assert.equal(await fs.readFile(path.join(f.project, "docs/guide.md"), "utf8"), "project-owned\n");
  assert.deepEqual(json(await fs.readFile(path.join(f.project, "config.json"), "utf8")), {
    ignore: ["local"],
    rules: { unrelated: true },
  });
});
await test("updates remove old declarations even when a bundle remains selected", async (t) => {
  const f = await fixture(t);
  await f.add("base", {
    scripts: { check: "echo old", retired: "echo retired" },
    devDependencies: { old: "1" },
  });
  const old = await f.load();
  await apply(await plan(f.project, old));
  await f.add("base", { scripts: { check: "echo new" }, devDependencies: { current: "2" } });
  const current = await f.load();
  const next = await plan(f.project, current, old);
  const pkg = manifest(content(next, "package.json"));
  assert.equal(pkg.devDependencies.old, undefined);
  assert.equal(pkg.devDependencies.current, "2");
  assert.equal(pkg.scripts.retired, undefined);
  assert.match(defined(pkg.scripts["its-checks:check"]), /echo new/);
});
await test("multiple sources compose independent contributions; identical dependencies coalesce", async (t) => {
  const f = await fixture(t);
  await f.add("base", { scripts: {}, devDependencies: { shared: "1" } });
  const a = await f.load();
  const b = await run(loadPolicy(f.policy, ["base"], { ...revision, repository: "other/policy" }));
  const combined = {
    root: a.root,
    sources: [...a.sources, ...b.sources],
    bundles: [...a.bundles, ...b.bundles],
  };
  const forward = await plan(f.project, combined);
  const reverse = await plan(f.project, {
    ...combined,
    bundles: combined.bundles.toReversed(),
    sources: combined.sources.toReversed(),
  });
  // State ordering is canonical too.
  assert.deepEqual(forward, reverse);
  assert.equal(manifest(content(forward, "package.json")).devDependencies.shared, "1");
  await f.add("base", { devDependencies: { shared: "2" } });
  const conflict = await run(
    loadPolicy(f.policy, ["base"], { ...revision, repository: "other/policy" }),
  );
  await assert.rejects(
    plan(f.project, { ...combined, bundles: [...a.bundles, ...conflict.bundles] }),
    /Dependency shared/,
  );
});
await test("target symlinks and parent symlinks are rejected before planning writes", async (t) => {
  const f = await fixture(t);
  await fs.symlink(path.join(f.root, "outside"), path.join(f.project, ".oxlintrc.json"));
  await assert.rejects(plan(f.project, await f.load()), /symlink|regular/i);
});
