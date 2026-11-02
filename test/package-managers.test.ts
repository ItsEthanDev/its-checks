import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { applyPlan, ApplicationError, OperationError } from "../src/application.ts";
import { loadPolicy } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { resolveTargetManager, createDependencyAdapter } from "../src/package-managers.ts";
import { planProject } from "../src/planning.ts";
import type { PackageManager } from "../src/scripts.ts";
import { fixture } from "./fixtures.ts";

const run = Effect.runPromise;
const managers: PackageManager[] = ["npm", "pnpm", "yarn", "bun"];
const put = async (root: string, file: string, value: string | object) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(
    path.join(root, file),
    typeof value === "string" ? value : JSON.stringify(value),
  );
};

test("manager evidence asks on absent, malformed, conflicting declarations/locks; explicit answer feeds script planning", async (t) => {
  const f = await fixture(t);
  assert.equal((await run(resolveTargetManager(f.project))).kind, "question");
  for (const manager of managers) {
    await put(f.project, "package.json", { packageManager: `${manager}@99.0.0` });
    const resolved = await run(resolveTargetManager(f.project));
    assert.equal(resolved.kind === "resolved" && resolved.target.manager, manager);
  }
  for (const [lock, manager] of [
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ]) {
    await put(f.project, "package.json", {});
    await put(f.project, lock!, "lock evidence only; never parsed");
    const resolved = await run(resolveTargetManager(f.project));
    assert.equal(resolved.kind === "resolved" && resolved.target.manager, manager);
    await fs.unlink(path.join(f.project, lock!));
  }
  await put(f.project, "package.json", { packageManager: "npm@99.0.0" });
  await put(f.project, "yarn.lock", "");
  let resolution = await run(resolveTargetManager(f.project));
  assert.equal(resolution.kind, "question");
  if (resolution.kind === "question")
    assert.deepEqual(resolution.evidence, ["packageManager: npm@99.0.0", "yarn.lock"]);
  resolution = await run(resolveTargetManager(f.project, "pnpm"));
  if (resolution.kind !== "resolved") throw Error("Expected explicit answer");
  const resolved = await run(
    resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {}),
  );
  const plan = await run(planProject(f.project, resolved, { scripts: resolution.target.scripts }));
  const state = plan.files.find((file) => file.path === "package.json")!.after;
  if (state.kind !== "file") throw Error("Expected manifest");
  assert.equal(
    JSON.parse(Buffer.from(state.base64, "base64").toString()).scripts.check,
    "pnpm run its-checks:check",
  );
  await put(f.project, "package.json", { packageManager: "unknown@1" });
  assert.equal((await run(resolveTargetManager(f.project))).kind, "question");
  assert.equal(
    await fs.readFile(path.join(f.project, "yarn.lock"), "utf8"),
    "",
    "other lockfiles are preserved",
  );
});

for (const manager of managers)
  test(`${manager}: normal install preserves approved intent, reruns, reports failures and retries without repairing native state`, async (t) => {
    const f = await fixture(t);
    await put(f.project, "package.json", {
      name: "app",
      packageManager: `${manager}@99.0.0`,
      scripts: { install: "exit 99", custom: "echo keep" },
      devDependencies: { unrelated: "1.0.0" },
      custom: true,
    });
    await f.add("base", { name: "Base", devDependencies: { managed: "1.0.0" } });
    const resolution = await run(resolveTargetManager(f.project));
    if (resolution.kind !== "resolved") throw Error("Expected manager");
    const plan = async () =>
      run(
        planProject(
          f.project,
          await run(
            resolveInputs(
              await run(loadPolicy(f.policy, { integrations: [], automation: [] })),
              {},
            ),
          ),
          { scripts: resolution.target.scripts },
        ),
      );
    const calls: unknown[] = [];
    let failure: "exit" | "spawn" | "mutate" | undefined;
    const adapter = createDependencyAdapter(resolution.target, {
      run: (cmd, args, cwd) => {
        calls.push([cmd, args, cwd]);
        if (failure === "spawn")
          return Effect.fail(new OperationError({ detail: "executable not found" }));
        return Effect.promise(async () => {
          if (failure === "mutate") await put(f.project, "package.json", { changed: true });
          return {
            code: failure === "exit" ? 42 : 0,
            stdout: "installer output",
            stderr: failure === "exit" ? "lifecycle failed" : "",
          };
        });
      },
    });
    const initial = await plan();
    assert.equal(await run(adapter.assess(initial)), "required");
    assert.equal(calls.length, 0, "preview never invokes a manager");
    assert.equal(
      (await run(applyPlan(initial, { approved: false, dependencies: adapter }))).status,
      "declined",
    );
    assert.equal(calls.length, 0);
    assert.equal(
      (await run(applyPlan(initial, { approved: true, dependencies: adapter }))).dependencyWork,
      "completed",
    );
    assert.deepEqual(calls, [[manager, ["install"], f.project]]);
    const approved = await fs.readFile(path.join(f.project, "package.json"), "utf8");
    const manifest = JSON.parse(approved);
    assert.equal(manifest.custom, true);
    assert.equal(manifest.scripts.install, "exit 99");
    assert.equal(manifest.devDependencies.unrelated, "1.0.0");
    assert.equal(manifest.devDependencies.managed, "1.0.0");
    // Success is the manager's exit status, not a fabricated inventory or lockfile audit.
    await assert.rejects(fs.stat(path.join(f.project, "node_modules")), { code: "ENOENT" });
    const matching = await plan();
    assert.ok(matching.files.every((file) => file.kind === "noop"));
    assert.equal(
      await run(adapter.assess(matching)),
      "required",
      "matching config does not prove dependencies are installed",
    );
    await run(applyPlan(matching, { approved: true, dependencies: adapter }));
    assert.equal(calls.length, 2);
    await put(f.project, "node_modules/.package-lock.json", "native metadata");
    await put(f.project, "node_modules/.bun/managed/package.json", "store target");
    await fs.symlink(".bun/managed", path.join(f.project, "node_modules/managed"));
    for (const mode of ["exit", "spawn"] as const) {
      failure = mode;
      const failed = await run(
        applyPlan(await plan(), { approved: true, dependencies: adapter }).pipe(
          Effect.match({
            onFailure: (e) => e,
            onSuccess: () => {
              throw Error("Expected failure");
            },
          }),
        ),
      );
      assert.ok(failed instanceof ApplicationError);
      assert.equal(failed.phase, "dependencies");
      assert.equal(failed.report.failed?.kind, "install-dependencies");
      assert.match(
        failed.message,
        mode === "exit" ? /42: lifecycle failed\ninstaller output/ : /executable not found/,
      );
      assert.ok(failed.message.includes(`rerun ${manager} install`));
      assert.equal(await fs.readFile(path.join(f.project, "package.json"), "utf8"), approved);
      assert.ok(await fs.readFile(path.join(f.project, ".its-checks.json"), "utf8"));
      assert.equal(
        await fs.readFile(path.join(f.project, "node_modules/.package-lock.json"), "utf8"),
        "native metadata",
      );
      assert.equal(await fs.readlink(path.join(f.project, "node_modules/managed")), ".bun/managed");
      assert.equal(
        await fs.readFile(path.join(f.project, "node_modules/managed/package.json"), "utf8"),
        "store target",
      );
      failure = undefined;
      assert.equal(
        (await run(applyPlan(await plan(), { approved: true, dependencies: adapter })))
          .dependencyWork,
        "completed",
      );
    }
    const stale = await plan();
    await put(f.project, "package.json", { stale: true });
    const count = calls.length;
    const error = await run(
      adapter
        .install(stale)
        .pipe(Effect.match({ onFailure: (e) => e.message, onSuccess: () => "unexpected" })),
    );
    assert.match(error, /differs from the exact approved/);
    assert.equal(calls.length, count);
    await fs.writeFile(path.join(f.project, "package.json"), approved);
    failure = "mutate";
    assert.match(
      await run(
        adapter
          .install(await plan())
          .pipe(Effect.match({ onFailure: (e) => e.message, onSuccess: () => "unexpected" })),
      ),
      /no longer matches approved bytes/,
    );
    const foreign = {
      ...stale,
      snapshot: { ...stale.snapshot, root: path.join(f.project, "other") },
    };
    assert.match(
      await run(
        adapter
          .install(foreign)
          .pipe(Effect.match({ onFailure: (e) => e.message, onSuccess: () => "unexpected" })),
      ),
      /another package root/,
    );
  });
