import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { applyPlan, type ApplicationDependencies } from "../src/application.ts";
import { loadPolicy, type PolicySelections } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject, type PlanOptions } from "../src/planning.ts";
import { createScriptPlanner } from "../src/scripts.ts";
import { fixture, snapshot } from "./fixtures.ts";

const run = Effect.runPromise;
const none: PolicySelections = { integrations: [], automation: [] };
const enabled: PolicySelections = { integrations: [], automation: ["local", "ci"] };
const hook = ".husky/pre-commit";
const dedicated = ".husky/its-checks-pre-commit";
const workflow = ".github/workflows/quality.yml";
const shell = "#!/bin/sh\n# its-checks: managed\nprintf 'native ${literal}'\nexit 99\n";
const yaml =
  "# its-checks: managed\nname: Native\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo '${literal}'\n";
const deps: ApplicationDependencies = {
  assess: () => Effect.succeed("not-required"),
  install: () => Effect.die("Never install"),
};
async function setup(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t);
  await f.add("automation/local");
  await f.add("automation/ci");
  await f.write(`typescript/automation/local/files/${dedicated}`, shell);
  await f.write(`typescript/automation/ci/files/${workflow}`, yaml);
  const put = async (relative: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(f.project, relative)), { recursive: true });
    await fs.writeFile(path.join(f.project, relative), content);
  };
  const read = (relative: string) => fs.readFile(path.join(f.project, relative), "utf8");
  const resolve = async (selection = enabled) =>
    await run(resolveInputs(await run(loadPolicy(f.policy, selection)), {}));
  const plan = async (selection = enabled, options: PlanOptions = {}) =>
    await run(
      planProject(f.project, await resolve(selection), {
        scripts: createScriptPlanner("npm"),
        ...options,
      }),
    );
  const apply = async (selection = enabled, options: PlanOptions = {}) => {
    const planned = await plan(selection, options);
    assert.equal(planned.complete, true);
    await run(applyPlan(planned, { approved: true, dependencies: deps }));
    return planned;
  };
  return { ...f, put, read, resolve, plan, apply };
}

for (const original of [
  "echo before\n",
  "#!/bin/sh\r\necho before\r\n",
  "echo before",
  "",
  "\uFEFFecho unicode ✓\n",
]) {
  await test(`enable, rerun, native edit and disable preserve hook bytes: ${JSON.stringify(original)}`, async (t) => {
    const f = await setup(t);
    await f.put(hook, original);
    await f.put(".github/workflows/unrelated.yml", "name: Unrelated\non: push\n");
    const resolved = await f.resolve();
    const options = { previous: resolved.intent, currentBundles: resolved.policy.bundles };
    const first = await f.apply();
    assert.equal(first.files.find((file) => file.path === hook)?.conflict, true);
    const installed = await f.read(hook);
    assert.ok(installed.startsWith(original));
    assert.equal(installed.match(/# BEGIN its-checks/g)?.length, 1);
    assert.ok(installed.includes("sh .husky/its-checks-pre-commit"));
    assert.equal(await f.read(dedicated), shell);
    assert.equal(await f.read(workflow), yaml);
    const matching = await f.plan(enabled, options);
    assert.equal(matching.requiresConfirmation, false);
    assert.ok(matching.files.every((file) => file.kind === "noop"));
    await f.apply(enabled, options);
    assert.equal(await f.read(hook), installed);
    const changedShell = shell.replace("exit 99", "exit 98");
    const changedYaml = yaml.replace("Native", "Edited native");
    await f.write(`typescript/automation/local/files/${dedicated}`, changedShell);
    await f.write(`typescript/automation/ci/files/${workflow}`, changedYaml);
    await f.put(dedicated, `${shell}# project edit\n`);
    const edited = await f.plan(enabled, options);
    assert.equal(edited.files.find((file) => file.path === dedicated)?.conflict, true);
    await run(applyPlan(edited, { approved: false, dependencies: deps }));
    assert.equal(await f.read(dedicated), `${shell}# project edit\n`);
    await run(applyPlan(edited, { approved: true, dependencies: deps }));
    assert.equal(await f.read(dedicated), changedShell);
    assert.equal(await f.read(workflow), changedYaml);
    assert.equal(await f.read(hook), installed);
    await f.apply(none, options);
    assert.equal(await f.read(hook), original);
    await f.apply(enabled);
    assert.equal(await f.read(hook), installed);
    // Preserve appended unrelated bytes too, including the END line's separator.
    await f.put(hook, `${installed}\necho after`);
    const disable = await f.plan(none, options);
    assert.equal(disable.requiresConfirmation, true);
    await run(applyPlan(disable, { approved: true, dependencies: deps }));
    assert.equal(await f.read(hook), `${original}\necho after`);
    await assert.rejects(f.read(dedicated), { code: "ENOENT" });
    await assert.rejects(f.read(workflow), { code: "ENOENT" });
    assert.equal(await f.read(".github/workflows/unrelated.yml"), "name: Unrelated\non: push\n");
  });
}

await test("current-known cleanup requires prior intent and retains shared selected requirements", async (t) => {
  const f = await setup(t);
  await f.add("automation/other");
  await f.write(`typescript/automation/other/files/${dedicated}`, shell);
  await f.write(`typescript/automation/other/files/${workflow}`, yaml);
  const selections = { integrations: [], automation: ["local", "ci", "other"] };
  const resolved = await f.resolve(selections);
  await f.apply(selections);
  const options = { previous: resolved.intent, currentBundles: resolved.policy.bundles };
  await f.apply({ integrations: [], automation: ["other"] }, options);
  assert.equal(await f.read(dedicated), shell);
  assert.equal(await f.read(workflow), yaml);
  assert.equal(
    (await f.plan(none)).files.some((file) => file.path === dedicated),
    false,
  );
  // Retired definitions cannot be reconstructed and leave manual cleanup, not guessed removal.
  const retired = await f.plan(none, { previous: resolved.intent, currentBundles: [] });
  assert.equal(
    retired.files.some((file) => file.path === workflow),
    false,
  );
});

for (const destination of [workflow, dedicated]) {
  await test(`unrelated dedicated content is a hard conflict for enable, cleanup and migration: ${destination}`, async (t) => {
    const f = await setup(t);
    const resolved = await f.resolve();
    await f.put(destination, "# user-owned\nname: keep\n");
    const before = await snapshot(f.project);
    await assert.rejects(f.plan(), /Unrelated content.*Move or rename/);
    await assert.rejects(
      f.plan(none, { previous: resolved.intent, currentBundles: resolved.policy.bundles }),
      /Unrelated content/,
    );
    await f.add("base", { name: "Base", migration: { removeFiles: [destination] } });
    await assert.rejects(f.plan(none), /Unrelated content/);
    assert.deepEqual(await snapshot(f.project), before);
  });
}

for (const content of [
  "echo keep\n# BEGIN its-checks\ncommand\n",
  "# END its-checks\n# BEGIN its-checks\n",
  "# BEGIN its-checks\nx\n# BEGIN its-checks\ny\n# END its-checks\n",
  "# BEGIN its-checks\nx\n# END its-checks\n# BEGIN its-checks\nx\n# END its-checks",
  " # BEGIN its-checks\nx\n# END its-checks\n",
]) {
  await test(`malformed hook blocks fail before mutation: ${JSON.stringify(content)}`, async (t) => {
    const f = await setup(t);
    const resolved = await f.resolve();
    await f.put(hook, content);
    const before = await snapshot(f.project);
    await assert.rejects(f.plan(), /Malformed or duplicate/);
    await assert.rejects(
      f.plan(none, { previous: resolved.intent, currentBundles: resolved.policy.bundles }),
      /Malformed or duplicate/,
    );
    assert.deepEqual(await snapshot(f.project), before);
  });
}

await test("identifiable edited invocation is replaced with confirmation; migration removes only the block", async (t) => {
  const f = await setup(t);
  const outside = "#!/bin/sh\necho before\n";
  await f.put(hook, `${outside}\n# BEGIN its-checks\necho edited\n# END its-checks\necho after`);
  await f.apply();
  assert.equal(
    await f.read(hook),
    `${outside}\n# BEGIN its-checks\nsh .husky/its-checks-pre-commit\n# END its-checks\necho after`,
  );
  await f.add("base", { name: "Base", migration: { removeFiles: [hook, dedicated, workflow] } });
  await assert.rejects(f.plan(), /Cannot remove selected automation/);
  await f.apply(none);
  assert.equal(await f.read(hook), `${outside}\necho after`);
  await assert.rejects(f.read(dedicated), { code: "ENOENT" });
});

await test("policy ownership and shared-hook conventions are validated without guessing", async (t) => {
  const f = await setup(t);
  await f.write(`typescript/automation/ci/files/${workflow}`, "name: Missing marker\non: push\n");
  await assert.rejects(f.plan(), /Dedicated automation requires/);
  await f.write(`typescript/automation/ci/files/${workflow}`, yaml);
  await f.write(`typescript/automation/local/files/${hook}`, "echo not shared policy\n");
  await assert.rejects(f.plan(), /Author the hook commands/);
});

await test("fresh hooks are executable, matching managed files need no history, and disabled empty hooks remain", async (t) => {
  const f = await setup(t);
  const resolved = await f.resolve();
  await f.apply();
  assert.equal((await fs.stat(path.join(f.project, hook))).mode & 0o777, 0o755);
  assert.equal(
    await f.read(hook),
    "# BEGIN its-checks\nsh .husky/its-checks-pre-commit\n# END its-checks",
  );
  assert.ok((await f.plan()).files.every((file) => file.kind === "noop"));
  await f.apply(none, { previous: resolved.intent, currentBundles: resolved.policy.bundles });
  assert.equal(await f.read(hook), "");
});

await test("different selected native contributions conflict with both sources before mutation", async (t) => {
  const f = await setup(t);
  await f.add("automation/other");
  await f.write(
    `typescript/automation/other/files/${workflow}`,
    yaml.replace("Native", "Different"),
  );
  const before = await snapshot(f.project);
  await assert.rejects(
    f.plan({ integrations: [], automation: ["ci", "other"] }),
    /Different dedicated automation contributions.*ci.*other/,
  );
  assert.deepEqual(await snapshot(f.project), before);
});

await test("a complete automation snapshot rejects stale hook changes before applying any files", async (t) => {
  const f = await setup(t);
  const planned = await f.plan();
  await f.put(hook, "echo appeared after planning\n");
  const before = await snapshot(f.project);
  await assert.rejects(
    run(applyPlan(planned, { approved: true, dependencies: deps })),
    /Target changed/,
  );
  assert.deepEqual(await snapshot(f.project), before);
});
