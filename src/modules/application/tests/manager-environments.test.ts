import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { fixture } from "../../../../test/shared/fixtures.ts";
import { planProject, type PackageManager } from "../../planning/index.ts";
import { loadPolicy, resolveInputs } from "../../policy/index.ts";
import { applyPlan, createDependencyAdapter, resolveTargetManager } from "../index.ts";

const run = Effect.runPromise;

for (const manager of ["npm", "pnpm", "yarn", "bun"] as PackageManager[]) {
  await test(`${manager}: project version, lockfile, linker and lifecycle settings belong to the manager`, async (t) => {
    const f = await fixture(t);
    await fs.writeFile(
      path.join(f.project, "package.json"),
      JSON.stringify({ name: "app", packageManager: `${manager}@99.0.0` }),
    );
    const files: Record<string, string | Buffer> = {
      ".npmrc": "ignore-scripts=true\nnode-linker=hoisted\nmanage-package-manager-versions=true\n",
      ".yarnrc": "--install.pnp true\n",
      ".pnp.cjs": "throw new Error('must not execute');\n",
      "bunfig.toml": '[install]\nlinker = "hoisted"\n',
      "node_modules/.package-lock.json": "native metadata\n",
      ...{
        npm: { "package-lock.json": '{"lockfileVersion":2}\n' },
        pnpm: { "pnpm-lock.yaml": "unrecognized native format\n" },
        yarn: { "yarn.lock": "unrecognized native format\n" },
        bun: { "bun.lockb": Buffer.from([0, 255, 128, 1]) },
      }[manager],
    };
    for (const [name, bytes] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(f.project, name)), { recursive: true });
      await fs.writeFile(path.join(f.project, name), bytes);
    }
    const resolution = await run(resolveTargetManager(f.project));
    if (resolution.kind !== "resolved") {
      throw Error("Expected manager");
    }
    let calls = 0;
    const adapter = createDependencyAdapter(resolution.target, {
      run: (command, args, cwd) => {
        calls++;
        assert.deepEqual([command, args, cwd], [manager, ["install"], f.project]);
        return Effect.succeed({ code: 0, stdout: "", stderr: "" });
      },
    });
    const plan = await run(
      planProject(
        f.project,
        await run(
          resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {}),
        ),
        { manager: resolution.target.manager },
      ),
    );
    assert.equal(await run(adapter.assess(plan)), "required");
    assert.equal(calls, 0);
    assert.equal(
      (await run(applyPlan(plan, { approved: true, dependencies: adapter }))).dependencyWork,
      "completed",
    );
    assert.equal(calls, 1);
    for (const [name, bytes] of Object.entries(files)) {
      assert.deepEqual(await fs.readFile(path.join(f.project, name)), Buffer.from(bytes));
    }
  });
}
