import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { loadPolicy } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject } from "../src/planning.ts";
import { applyPlan } from "../src/application.ts";
import { createDependencyAdapter, resolveTargetManager, testedVersions } from "../src/package-managers.ts";
import type { PackageManager } from "../src/scripts.ts";
import { fixture } from "./fixtures.ts";

const run = Effect.runPromise;

test("unsupported versions, disabled lifecycles, Yarn PnP and Bun hoisting fail explicitly, not skipped or silently changed", async (t) => {
  const f = await fixture(t);
  let config = "false", version = "", installs = 0;
  for (const manager of Object.keys(testedVersions) as PackageManager[]) {
    const manifest = { name: "app", packageManager: `${manager}@${testedVersions[manager]}` };
    await fs.writeFile(path.join(f.project, "package.json"), JSON.stringify(manifest));
    await fs.writeFile(path.join(f.project, "bunfig.toml"), '[install]\nlinker = "isolated"\n');
    await fs.writeFile(path.join(f.project, ".npmrc"), 'manage-package-manager-versions=false\n');
    const resolution = await run(resolveTargetManager(f.project));
    if (resolution.kind !== "resolved") throw Error("Expected manager");
    const plan = await run(planProject(f.project, await run(resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {})), { scripts: resolution.target.scripts }));
    const adapter = createDependencyAdapter(resolution.target, { run: (_cmd, args) => {
      if (args[0] === "install") installs++;
      return Effect.succeed({ code: 0, stdout: args[0] === "--version" ? version : config, stderr: "" });
    } });
    const assessError = () => run(adapter.assess(plan).pipe(Effect.match({ onFailure: (e) => e.message, onSuccess: () => "unexpected" })));
    version = "0.0.0";
    assert.match(await assessError(), /requires tested version/);
    version = testedVersions[manager];
    if (manager !== "bun") {
      config = "true";
      assert.match(await assessError(), /lifecycle scripts must be enabled/);
      config = "false";
    }
    if (manager === "yarn") {
      await fs.writeFile(path.join(f.project, ".pnp.js"), "never execute");
      assert.match(await assessError(), /PnP is not supported/);
      await fs.unlink(path.join(f.project, ".pnp.js"));
    }
    if (manager === "pnpm") {
      await fs.unlink(path.join(f.project, ".npmrc"));
      assert.match(await assessError(), /assessment must not download/);
      await fs.writeFile(path.join(f.project, ".npmrc"), 'manage-package-manager-versions=false\n');
    }
    if (manager === "bun") {
      await fs.writeFile(path.join(f.project, "bunfig.toml"), '[install]\nlinker = "hoisted"\n');
      assert.match(await assessError(), /hoisted recovery is not supported/);
    }
    await fs.writeFile(path.join(f.project, "package.json"), JSON.stringify({ ...manifest, packageManager: `${manager}@0.0.0` }));
    assert.match(await assessError(), /Unsupported declaration/);
  }
  assert.equal(installs, 0);
});

test("a failed native metadata invalidation reports both the original failure and unguaranteed recovery", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project, "package.json"), '{"name":"app","packageManager":"npm@11.19.0"}');
  const resolution = await run(resolveTargetManager(f.project));
  if (resolution.kind !== "resolved") throw Error("Expected manager");
  const plan = await run(planProject(f.project, await run(resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {})), { scripts: resolution.target.scripts }));
  const adapter = createDependencyAdapter(resolution.target, { run: (_cmd, args) => {
    if (args[0] !== "install") return Effect.succeed({ code: 0, stdout: args[0] === "--version" ? "11.19.0" : "false", stderr: "" });
    return Effect.promise(async () => {
      await fs.mkdir(path.join(f.project, "node_modules/.package-lock.json"), { recursive: true });
      return { code: 42, stdout: "", stderr: "original root lifecycle failure" };
    });
  } });
  const failed = await run(applyPlan(plan, { approved: true, dependencies: adapter }).pipe(Effect.match({
    onFailure: (e) => e.message, onSuccess: () => "unexpected" })));
  assert.match(failed, /original root lifecycle failure/);
  assert.match(failed, /Refusing to invalidate nonregular native metadata/);
  assert.match(failed, /retry cannot be guaranteed/);
  assert.ok((await fs.stat(path.join(f.project, "node_modules/.package-lock.json"))).isDirectory());
});
