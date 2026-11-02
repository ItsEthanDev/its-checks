import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { loadPolicy, type PolicySelections } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject, type ChangePlan, type PlanOptions } from "../src/planning.ts";
import { createScriptPlanner, type PackageManager } from "../src/scripts.ts";
import { fixture, snapshot } from "./fixtures.ts";

const run = Effect.runPromise;
const empty: PolicySelections = { integrations: [], automation: [] };
function manifest(plan: ChangePlan): { scripts: Record<string, string> } {
  const after = plan.files.find((file) => file.path === "package.json")!.after;
  assert.equal(after.kind, "file");
  return JSON.parse(Buffer.from(after.base64, "base64").toString("utf8"));
}
async function setup(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t);
  await f.add("base", { name: "TypeScript" });
  const resolve = async (selections = empty) =>
    await run(resolveInputs(await run(loadPolicy(f.policy, selections)), {}));
  const plan = async (
    selections = empty,
    manager: PackageManager = "npm",
    options: PlanOptions = {},
  ) =>
    await run(
      planProject(f.project, await resolve(selections), {
        ...options,
        scripts: createScriptPlanner(manager),
      }),
    );
  const writeScripts = async (scripts: Record<string, string>) =>
    await fs.writeFile(
      path.join(f.project, "package.json"),
      JSON.stringify({ name: "fixture", scripts }),
    );
  // Test-only materialization of planned bytes, not a production application adapter.
  const materialize = async (p: ChangePlan) => {
    for (const file of p.files)
      {if (file.after.kind === "file") {
        await fs.mkdir(path.dirname(path.join(f.project, file.path)), { recursive: true });
        await fs.writeFile(
          path.join(f.project, file.path),
          Buffer.from(file.after.base64, "base64"),
        );
      }}
  };
  const bin = path.join(f.root, "fake-managers");
  await fs.mkdir(bin);
  // Fake package runners ONLY: real /bin/sh execution, no installs or PM lifecycle behavior.
  // In particular, the shared fixture's "install": "exit 99" is never invoked.
  for (const manager of ["npm", "pnpm", "yarn", "bun"])
    {await fs.writeFile(
      path.join(bin, manager),
      `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
if (process.argv[2] !== 'run' || process.argv.length !== 4) process.exit(88);
fs.appendFileSync('runner.log', require('node:path').basename(process.argv[1]) + ' run ' + process.argv[3] + '\\n');
const command = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts[process.argv[3]];
if (typeof command !== 'string') process.exit(89);
const result = spawnSync('/bin/sh', ['-c', command], { stdio: 'inherit' });
process.exit(result.status ?? 90);
`,
      { mode: 0o755 },
    );}
  const execute = (p: ChangePlan, name: string) =>
    spawnSync("/bin/sh", ["-c", manifest(p).scripts[name]!], {
      cwd: f.project,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
      timeout: 5000,
    });
  return { ...f, plan, resolve, writeScripts, materialize, execute };
}

test("check and prepare compose in bundle order, deduplicate exact strings and retain unrelated scripts", async (t) => {
  const f = await setup(t);
  await f.add("base", {
    name: "Base",
    scripts: { check: "printf 'base\\n'", prepare: "printf 'base\\n'" },
  });
  await f.add("integrations/z", {
    name: "Z",
    scripts: { check: "printf 'z\\n'", prepare: "printf 'z\\n'" },
  });
  await f.add("integrations/a", {
    name: "A",
    scripts: { check: "printf 'base\\n'", prepare: "printf 'a\\n'" },
  });
  await f.add("automation/ci", {
    name: "CI",
    scripts: { check: "printf 'ci\\n'", prepare: "printf 'ci\\n'" },
  });
  const selections = { integrations: ["z", "a"], automation: ["ci"] };
  const before = await snapshot(f.project);
  const p = await f.plan(selections);
  assert.equal(p.complete, true);
  assert.equal(p.requiresConfirmation, false);
  assert.equal(manifest(p).scripts.install, "exit 99");
  assert.deepEqual(await snapshot(f.project), before, "planning is read-only");
  assert.deepEqual(p, await f.plan({ ...selections, integrations: ["a", "z"] }));
  await f.materialize(p);
  for (const [name, expected] of [
    ["check", "base\nz\nci\n"],
    ["prepare", "base\na\nz\nci\n"],
  ]) {
    const result = f.execute(p, name!);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
  const rerun = await f.plan(selections);
  assert.ok(rerun.files.every((file) => file.kind === "noop"));
  assert.equal(rerun.requiresConfirmation, false);
});

test("only exact duplicates collapse; equivalent but different strings still execute", async (t) => {
  const f = await setup(t);
  await f.add("base", { name: "Base", scripts: { check: "printf x" } });
  await f.add("integrations/a", { name: "A", scripts: { check: "printf x " } });
  await f.add("integrations/b", { name: "B", scripts: { check: "printf x" } });
  const p = await f.plan({ integrations: ["b", "a"], automation: [] });
  await f.materialize(p);
  const result = f.execute(p, "check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "xx");
});

test("a replacement keeps its target's position and restores it on deselection", async (t) => {
  const f = await setup(t);
  await f.add("base", {
    name: "Base",
    scripts: { lint: "printf 'base\\n'", check: "npm run lint" },
  });
  await f.add("integrations/a", { name: "A", scripts: { lint: "printf 'extra\\n'" } });
  await f.add("integrations/z", {
    name: "Z",
    scripts: { lint: { command: "printf 'replacement\\n'", replaces: "base" } },
  });
  await f.writeScripts({ lint: "printf 'original\\n'", other: "echo untouched" });
  const selected = { integrations: ["z", "a"], automation: [] };
  const known = await run(loadPolicy(f.policy, selected));
  const p = await f.plan(selected);
  await f.materialize(p);
  const result = f.execute(p, "check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "original\nreplacement\nextra\n");
  assert.equal(manifest(p).scripts.other, "echo untouched");
  assert.ok((await f.plan(selected)).files.every((file) => file.kind === "noop"));
  const restored = await f.plan({ integrations: ["a"], automation: [] }, "npm", {
    previous: (await f.resolve(selected)).intent,
    currentBundles: known.bundles,
  });
  await f.materialize(restored);
  const after = f.execute(restored, "check");
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, "original\nbase\nextra\n");
});

test("replacement targets retain their identity until after command deduplication", async (t) => {
  const f = await setup(t);
  await f.add("base", { name: "Base", scripts: { check: "printf 'shared\\n'" } });
  await f.add("integrations/a", { name: "A", scripts: { check: "printf 'shared\\n'" } });
  await f.add("integrations/b", {
    name: "B",
    scripts: { check: { command: "printf 'replacement\\n'", replaces: "base" } },
  });
  const p = await f.plan({ integrations: ["a", "b"], automation: [] });
  await f.materialize(p);
  const result = f.execute(p, "check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "replacement\nshared\n");
});

test("missing targets and conflicting replacements fail read-only with source context", async (t) => {
  const f = await setup(t);
  await f.add("base", { name: "Base", scripts: { check: "printf base" } });
  await f.add("integrations/a", {
    name: "A",
    scripts: { check: { command: "printf a", replaces: "integrations/missing" } },
  });
  const before = await snapshot(f.project);
  await assert.rejects(
    f.plan({ integrations: ["a"], automation: [] }),
    /integrations\/a\/bundle\.json.*scripts\.check.*integrations\/missing/s,
  );
  await f.add("integrations/a", {
    name: "A",
    scripts: { check: { command: "printf a", replaces: "base" } },
  });
  await f.add("integrations/b", {
    name: "B",
    scripts: { check: { command: "printf b", replaces: "base" } },
  });
  for (const integrations of [
    ["a", "b"],
    ["b", "a"],
  ]) {
    await assert.rejects(
      f.plan({ integrations, automation: [] }),
      /integrations\/b\/bundle\.json.*scripts\.check.*[Cc]onflict.*integrations\/a\/bundle\.json/s,
    );
  }
  assert.deepEqual(await snapshot(f.project), before);
});

test("identical replacements coalesce and can target an integration contribution", async (t) => {
  const f = await setup(t);
  await f.add("base", { name: "Base", scripts: { check: "printf 'base\\n'" } });
  await f.add("integrations/a", { name: "A", scripts: { check: "printf 'extra\\n'" } });
  for (const id of ["b", "c"])
    {await f.add(`integrations/${id}`, {
      name: id,
      scripts: { check: { command: "printf 'replacement\\n'", replaces: "integrations/a" } },
    });}
  const p = await f.plan({ integrations: ["c", "a", "b"], automation: [] });
  await f.materialize(p);
  const result = f.execute(p, "check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "base\nreplacement\n");
});

test("an absent scripts section stays absent when there is nothing to manage", async (t) => {
  const f = await setup(t);
  await fs.writeFile(path.join(f.project, "package.json"), '{ "name": "fixture" }\n');
  const p = await f.plan();
  assert.equal(manifest(p).scripts, undefined);
  assert.equal(p.files.find((file) => file.path === "package.json")!.kind, "noop");
});

test("opaque compound originals and contributions keep POSIX shell semantics", async (t) => {
  const originals = [
    "printf 'one\\n' && printf 'two\\n'",
    "false || printf 'fallback\\n'",
    "false; printf 'last\\n'",
    "printf 'pipe\\n' | tr a-z A-Z",
    "(printf 'subshell\\n')",
    "printf 'comment\\n' # closing group must not be commented out",
    "printf 'multiline\\n'\nprintf 'next\\n'",
    "cat <<'END'\nheredoc\nEND",
    "printf 'continued\\n' \\",
  ];
  const expected = [
    "one\ntwo\n",
    "fallback\n",
    "last\n",
    "PIPE\n",
    "subshell\n",
    "comment\n",
    "multiline\nnext\n",
    "heredoc\n",
    "continued\n",
  ];
  const f = await setup(t);
  for (let index = 0; index < originals.length; index++) {
    const original = originals[index]!;
    await f.writeScripts({ check: original, untouched: "echo untouched" });
    await f.add("base", { name: "Base", scripts: { check: original } });
    await f.add("integrations/end", { name: "End", scripts: { check: "printf 'managed-end\\n'" } });
    const p = await f.plan({ integrations: ["end"], automation: [] });
    await f.materialize(p);
    const result = f.execute(p, "check");
    assert.equal(result.status, 0, `${original}: ${result.stderr}`);
    assert.equal(result.stdout, `${expected[index]! + expected[index]!  }managed-end\n`);
    assert.equal(manifest(p).scripts.untouched, "echo untouched");
  }
});

test("failure in an original or contribution prevents later expressions, without flattening ||", async (t) => {
  const f = await setup(t);
  await f.add("base", {
    name: "Base",
    scripts: { check: "false || (printf 'recovered\\n'; exit 7)" },
  });
  await f.add("integrations/end", { name: "End", scripts: { check: "printf 'must-not-run\\n'" } });
  const selected = { integrations: ["end"], automation: [] };
  let p = await f.plan(selected);
  await f.materialize(p);
  let result = f.execute(p, "check");
  assert.equal(result.status, 7);
  assert.equal(result.stdout, "recovered\n");
  await f.writeScripts({ check: "printf 'original\\n'; exit 9" });
  p = await f.plan(selected);
  await f.materialize(p);
  result = f.execute(p, "check");
  assert.equal(result.status, 9);
  assert.equal(result.stdout, "original\n");
});

test("deselection rebuilds shared scripts, restores original bytes and removes originally absent wrappers", async (t) => {
  const f = await setup(t);
  const original = "printf 'original\\n' # retained exactly\n";
  await f.writeScripts({ check: original, other: "echo other" });
  await f.add("integrations/a", {
    name: "A",
    scripts: { check: "printf 'shared\\n'", prepare: "printf 'prepare\\n'" },
  });
  await f.add("integrations/b", { name: "B", scripts: { check: "printf 'shared\\n'" } });
  const both = { integrations: ["a", "b"], automation: [] };
  const known = await run(loadPolicy(f.policy, both));
  const p = await f.plan(both);
  await f.materialize(p);
  const previous = (await f.resolve(both)).intent;
  const one = await f.plan({ integrations: ["b"], automation: [] }, "npm", {
    previous,
    currentBundles: known.bundles,
  });
  assert.equal(manifest(one).scripts["its-checks:check"], manifest(p).scripts["its-checks:check"]);
  assert.equal(manifest(one).scripts.prepare, undefined);
  assert.equal(manifest(one).scripts["its-checks:prepare"], undefined);
  await f.materialize(one);
  const none = await f.plan(empty, "npm", { previous, currentBundles: known.bundles });
  assert.deepEqual(manifest(none).scripts, { check: original, other: "echo other" });
  assert.equal(none.requiresConfirmation, true);
  await f.materialize(none);
  const result = f.execute(none, "check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "original\n");
});

test("edited helpers are normal replacement conflicts, not inferred command history", async (t) => {
  const f = await setup(t);
  await f.add("base", { name: "Base", scripts: { check: "echo prescribed" } });
  const first = await f.plan();
  const scripts = manifest(first).scripts;
  scripts["its-checks:check"] = "echo locally edited";
  await f.writeScripts(scripts);
  const p = await f.plan();
  const helper = p.packageEntries.find((entry) => entry.name === "its-checks:check")!;
  assert.equal(helper.kind, "replacement");
  assert.equal(helper.conflict, true);
  assert.equal(p.requiresConfirmation, true);
  assert.equal(manifest(p).scripts.check, scripts.check);
  assert.equal(
    manifest(p).scripts["its-checks:check"],
    manifest(first).scripts["its-checks:check"],
  );
});

test("edited public references and unowned reserved helpers fail actionably without mutation", async (t) => {
  const f = await setup(t);
  await f.add("base", { name: "Base", scripts: { check: "echo managed" } });
  for (const scripts of [
    { check: "npm run its-checks:check && echo edited" },
    { check: "(echo old) && npm run its-checks:check" },
    { check: "echo original", "its-checks:check": "echo collision" },
    { "its-checks:check": "echo collision" },
  ]) {
    await f.writeScripts(scripts);
    const before = await snapshot(f.project);
    await assert.rejects(
      f.plan(),
      /scripts.check:.*(Restore the generated wrapper|Reserved namespace collision)/,
    );
    assert.deepEqual(await snapshot(f.project), before);
  }
  await f.add("base", { name: "Base", scripts: { "its-checks:custom": "echo forbidden" } });
  await assert.rejects(f.plan(), /reserved its-checks: namespace/);
});

test("all target manager runners execute and exact wrappers migrate safely between managers", async (t) => {
  const f = await setup(t);
  await f.add("base", {
    name: "Base",
    scripts: { check: "printf 'managed\\n'", prepare: "printf 'prepared\\n'" },
  });
  await f.add("integrations/override", {
    name: "Override",
    scripts: { check: { command: "printf 'replacement\\n'", replaces: "base" } },
  });
  const selected = { integrations: ["override"], automation: [] };
  const original = "printf 'original\\n'";
  await f.writeScripts({ check: original });
  for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
    const p = await f.plan(selected, manager);
    assert.equal(
      manifest(p).scripts.check!.split(" && ").at(-1),
      `${manager} run its-checks:check`,
    );
    await f.materialize(p);
    assert.equal(f.execute(p, "check").stdout, "original\nreplacement\n");
    const prepared = f.execute(p, "prepare");
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(prepared.stdout, "prepared\n");
    assert.equal(manifest(p).scripts.prepare, `${manager} run its-checks:prepare`);
    assert.ok((await f.plan(selected, manager)).files.every((file) => file.kind === "noop"));
  }
  assert.equal(
    await fs.readFile(path.join(f.project, "runner.log"), "utf8"),
    "npm run its-checks:check\nnpm run its-checks:prepare\npnpm run its-checks:check\npnpm run its-checks:prepare\nyarn run its-checks:check\nyarn run its-checks:prepare\nbun run its-checks:check\nbun run its-checks:prepare\n",
  );
});
