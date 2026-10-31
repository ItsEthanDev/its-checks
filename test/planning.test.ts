import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { loadPolicy, type PolicySelections } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject, assertTargetUnchanged, readTargetSnapshot, type ChangePlan } from "../src/planning.ts";
import { fixture, snapshot } from "./fixtures.ts";

const run = Effect.runPromise;
const empty: PolicySelections = { integrations: [], automation: [] };
const output = (plan: ChangePlan, relative: string) => {
  const file = plan.files.find((file) => file.path === relative)!;
  assert.equal(file.after.kind, "file");
  return Buffer.from(file.after.base64, "base64").toString("utf8");
};
const value = (plan: ChangePlan, relative: string) => JSON.parse(output(plan, relative));
const changed = (plan: ChangePlan) => plan.files.filter((file) => file.kind !== "noop").map((file) => [file.path, file.kind]);
async function setup(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t);
  await f.add("base", { name: "TypeScript", devDependencies: { oxlint: "1.0.0" } });
  const resolve = async (selections = empty) => run(resolveInputs(await run(loadPolicy(f.policy, selections)), {}));
  const writeProject = async (relative: string, content: string | object) => {
    const destination = path.join(f.project, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, typeof content === "string" ? content : JSON.stringify(content));
  };
  return { ...f, resolve, writeProject };
}

test("fresh package gets a complete read-only plan with exact creations, additions, and stale observations", async (t) => {
  const f = await setup(t);
  const before = await snapshot(f.project);
  const plan = await run(planProject(f.project, await f.resolve()));
  assert.deepEqual(changed(plan), [[".its-checks.json", "creation"], [".oxfmtrc.json", "creation"], [".oxlintrc.json", "creation"], ["package.json", "addition"]]);
  assert.equal(plan.requiresConfirmation, false);
  assert.equal(plan.complete, true);
  assert.deepEqual(value(plan, ".oxlintrc.json"), { rules: { "no-debugger": "error" } });
  assert.deepEqual(value(plan, ".oxfmtrc.json"), {});
  assert.deepEqual(value(plan, "package.json"), { name: "untouched", scripts: { install: "exit 99" }, devDependencies: { oxlint: "1.0.0" } });
  assert.deepEqual(await snapshot(f.project), before);
  assert.equal(plan.snapshot.files["oxlint.config.ts"]!.kind, "absent");
  await run(assertTargetUnchanged(plan.snapshot));
  await f.writeProject("oxlint.config.ts", "throw Error('never execute');");
  await assert.rejects(run(assertTargetUnchanged(plan.snapshot)), /Target changed since planning/);
});

test("native fragments compose in stable category order with atomic rules, ordered deduplication and overrides", async (t) => {
  const f = await setup(t);
  await f.write("typescript/base/files/.oxlintrc.json", {
    rules: { tuple: ["warn", { allow: ["base"], nested: { base: true } }], baseline: "error" },
    plugins: ["typescript"], jsPlugins: [{ name: "p", specifier: "package" }], extends: ["./node_modules/preset/base.json"],
    overrides: [{ files: ["base/**"], rules: { tuple: "off" } }],
    settings: { plugin: { baseline: true }, retained: 1 }, options: { typeAware: true }, ignorePatterns: ["base"],
  });
  await f.write("typescript/base/files/.oxfmtrc.jsonc", { sortImports: { groups: ["base"], newlinesBetween: 1 }, ignorePatterns: ["base"], overrides: [{ files: ["base/**"], options: { semi: true } }] });
  for (const key of ["integrations/z", "integrations/a", "automation/ci"]) await f.add(key);
  await f.write("typescript/integrations/a/files/.oxlintrc.json", {
    rules: { tuple: ["error", { allow: ["a"] }] }, plugins: ["typescript", "react"],
    jsPlugins: [{ specifier: "package", name: "p" }, "other"], extends: ["./node_modules/preset/base.json", "./node_modules/preset/a.json"],
    settings: { plugin: { replaced: true } }, options: { typeAware: false }, ignorePatterns: ["a"],
    overrides: [{ files: ["a/**"], rules: { tuple: ["warn", {}] } }],
  });
  await f.write("typescript/integrations/z/files/.oxlintrc.jsonc", { rules: { tuple: ["error", { allow: ["z"] }] }, overrides: [{ files: ["z/**"] }] });
  await f.write("typescript/automation/ci/files/.oxlintrc.json", { globals: { window: "readonly" }, overrides: [{ files: ["ci/**"] }] });
  await f.write("typescript/integrations/a/files/.oxfmtrc.json", { sortImports: { groups: ["a"] }, ignorePatterns: ["a"], overrides: [{ files: ["a/**"], options: { semi: false } }] });
  const first = await run(planProject(f.project, await f.resolve({ integrations: ["z", "a"], automation: ["ci"] })));
  const second = await run(planProject(f.project, await f.resolve({ integrations: ["a", "z"], automation: ["ci"] })));
  assert.deepEqual(first, second);
  assert.deepEqual(value(first, ".oxlintrc.json"), {
    rules: { baseline: "error", tuple: ["error", { allow: ["z"] }] }, plugins: ["typescript", "react"],
    jsPlugins: [{ name: "p", specifier: "package" }, "other"], extends: ["./node_modules/preset/base.json", "./node_modules/preset/a.json"],
    settings: { plugin: { replaced: true }, retained: 1 }, options: { typeAware: false }, ignorePatterns: ["a"], globals: { window: "readonly" },
    overrides: [{ files: ["base/**"], rules: { tuple: "off" } }, { files: ["a/**"], rules: { tuple: ["warn", {}] } }, { files: ["z/**"] }, { files: ["ci/**"] }],
  });
  assert.deepEqual(value(first, ".oxfmtrc.json"), { sortImports: { groups: ["a"] }, ignorePatterns: ["a"], overrides: [
    { files: ["base/**"], options: { semi: true } }, { files: ["a/**"], options: { semi: false } },
  ] });
});

test("existing dedicated configuration is replaced, never inherited; matching JSON preserves exact bytes", async (t) => {
  const f = await setup(t);
  await f.writeProject(".oxlintrc.json", { rules: { local: "error", "no-debugger": "off" } });
  await f.writeProject(".oxfmtrc.json", "{   }\n\n");
  const plan = await run(planProject(f.project, await f.resolve()));
  assert.deepEqual(value(plan, ".oxlintrc.json"), { rules: { "no-debugger": "error" } });
  assert.equal(plan.files.find((file) => file.path === ".oxlintrc.json")!.kind, "replacement");
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(output(plan, ".oxfmtrc.json"), "{   }\n\n");
  assert.equal(plan.files.find((file) => file.path === ".oxfmtrc.json")!.kind, "noop");
});

test("explicit migration and alternate config names are proposed without executing modules or guessing cleanup", async (t) => {
  const f = await setup(t);
  await f.add("base", { name: "Base", migration: { removeFiles: ["prettier.config.js"], removeDevDependencies: ["prettier"] } });
  const sentinel = path.join(f.project, "EXECUTED");
  const executable = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'bad'); throw Error('executed');`;
  for (const relative of ["prettier.config.js", "oxlint.config.ts", "oxfmt.config.mjs"]) await f.writeProject(relative, executable);
  await f.writeProject("unlisted-legacy.js", executable);
  await f.writeProject(".oxlintrc.jsonc", "{ // not imported\n}");
  await f.writeProject("package.json", { scripts: { legacy: "prettier ." }, devDependencies: { prettier: "3", other: "4" }, dependencies: { prettier: "2" } });
  const before = await snapshot(f.project);
  const plan = await run(planProject(f.project, await f.resolve()));
  for (const relative of ["prettier.config.js", "oxlint.config.ts", "oxfmt.config.mjs", ".oxlintrc.jsonc"]) {
    const file = plan.files.find((file) => file.path === relative)!;
    assert.equal(file.kind, "removal"); assert.equal(file.conflict, true);
  }
  assert.equal(plan.files.some((file) => file.path === "unlisted-legacy.js"), false);
  assert.deepEqual(value(plan, "package.json"), { scripts: { legacy: "prettier ." }, devDependencies: { other: "4" }, dependencies: { prettier: "2" } });
  assert.deepEqual(await snapshot(f.project), before);
  await assert.rejects(fs.stat(sentinel), { code: "ENOENT" });
});

test("different dependency requirements fail with both policy sources, not range resolution", async (t) => {
  const f = await setup(t);
  await f.add("integrations/a", { name: "Alpha", dependencies: { oxlint: "^1.0.0" } });
  const before = await snapshot(f.project);
  await assert.rejects(run(planProject(f.project, await f.resolve({ integrations: ["a"], automation: [] }))), (error: Error) => {
    assert.match(error.message, /Dependency oxlint/);
    assert.match(error.message, /base \(TypeScript, .*bundle.json\) requires "1.0.0"/);
    assert.match(error.message, /integrations\/a \(Alpha, .*bundle.json\) requires "\^1.0.0"/);
    return true;
  });
  assert.deepEqual(await snapshot(f.project), before);
});

test("same-version cross-section requests use runtime placement; existing versions are confirmation conflicts", async (t) => {
  const f = await setup(t);
  await f.add("integrations/runtime", { name: "Runtime", dependencies: { oxlint: "1.0.0" } });
  await f.writeProject("package.json", { private: true, custom: { preserve: [1, 2] }, dependencies: { app: "2", oxlint: "old" }, devDependencies: { oxlint: "old-dev", test: "3" }, optionalDependencies: { oxlint: "optional" } });
  const plan = await run(planProject(f.project, await f.resolve({ integrations: ["runtime"], automation: [] })));
  assert.deepEqual(value(plan, "package.json"), { private: true, custom: { preserve: [1, 2] }, dependencies: { app: "2", oxlint: "1.0.0" }, devDependencies: { test: "3" }, optionalDependencies: { oxlint: "optional" } });
  assert.equal(plan.requiresConfirmation, true);
  assert.deepEqual(plan.packageEntries.filter((entry) => entry.name === "oxlint").map((entry) => [entry.section, entry.before, entry.after, entry.kind]), [
    ["dependencies", "old", "1.0.0", "replacement"], ["devDependencies", "old-dev", null, "removal"],
  ]);
});

test("deselection removes only current-known contributions and keeps requirements and files shared by remaining bundles", async (t) => {
  const f = await setup(t);
  await f.add("integrations/a", { name: "A", devDependencies: { shared: "1", unique: "2" } });
  await f.add("integrations/b", { name: "B", devDependencies: { shared: "1" } });
  await f.write("typescript/integrations/a/files/known.json", { associated: true });
  await f.write("typescript/integrations/a/files/shared.json", '{"shared":true}');
  await f.write("typescript/integrations/b/files/shared.json", '{"shared":true}');
  await f.writeProject("known.json", { associated: true });
  await f.writeProject("shared.json", { shared: true });
  await f.writeProject("historical-renamed.json", { keep: true });
  await f.writeProject("package.json", { devDependencies: { shared: "1", unique: "2", retired: "3" } });
  const prior = await f.resolve({ integrations: ["a", "b"], automation: [] });
  const current = await f.resolve({ integrations: ["b"], automation: [] });
  const before = await snapshot(f.project);
  const plan = await run(planProject(f.project, current, { previous: { ...prior.intent, integrations: ["a", "b", "retired"] }, currentBundles: prior.policy.bundles }));
  assert.equal(plan.files.find((file) => file.path === "known.json")!.kind, "removal");
  assert.equal(plan.files.find((file) => file.path === "shared.json")!.kind, "noop");
  assert.equal(plan.files.some((file) => file.path === "historical-renamed.json"), false);
  assert.deepEqual(value(plan, "package.json").devDependencies, { shared: "1", oxlint: "1.0.0", retired: "3" });
  assert.deepEqual(await snapshot(f.project), before);
});

test("migration is selected-only and cannot remove any remaining selected dependency requirement", async (t) => {
  const f = await setup(t);
  await f.add("base", { name: "Base", devDependencies: { shared: "1" }, migration: { removeDependencies: ["shared"], removeDevDependencies: ["shared"] } });
  await f.add("integrations/unused", { name: "Unused", migration: { removeFiles: ["unselected-legacy.json"], removeDevDependencies: ["unrelated"] } });
  await f.writeProject("unselected-legacy.json", {});
  await f.writeProject("package.json", { devDependencies: { shared: "1", unrelated: "2" } });
  const plan = await run(planProject(f.project, await f.resolve()));
  assert.deepEqual(value(plan, "package.json"), { devDependencies: { shared: "1", unrelated: "2" } });
  assert.equal(plan.files.find((file) => file.path === "package.json")!.kind, "noop");
  assert.equal(plan.files.some((file) => file.path === "unselected-legacy.json"), false);
});

test("dependency names that match object prototypes remain ordinary additions", async (t) => {
  const f = await setup(t);
  await f.add("base", { name: "Base", dependencies: { constructor: "1" } });
  await f.writeProject("package.json", { dependencies: {} });
  const plan = await run(planProject(f.project, await f.resolve()));
  assert.deepEqual(value(plan, "package.json").dependencies, { constructor: "1" });
  assert.equal(plan.packageEntries.find((entry) => entry.section === "dependencies" && entry.name === "constructor")!.kind, "addition");
  assert.equal(plan.requiresConfirmation, false);
});

test("snapshots retain arbitrary migration bytes and stale checks include mode and content", async (t) => {
  const f = await setup(t);
  const bytes = Buffer.from([0xff, 0x00, 0x80, 0x61]);
  await fs.writeFile(path.join(f.project, "legacy.bin"), bytes, { mode: 0o600 });
  await f.add("base", { name: "Base", migration: { removeFiles: ["legacy.bin"] } });
  const plan = await run(planProject(f.project, await f.resolve()));
  assert.deepEqual(plan.snapshot.files["legacy.bin"], { kind: "file", base64: "/wCAYQ==", mode: 0o600 });
  await fs.chmod(path.join(f.project, "legacy.bin"), 0o644);
  await assert.rejects(run(assertTargetUnchanged(plan.snapshot)), /Target changed/);
  await fs.chmod(path.join(f.project, "legacy.bin"), 0o600);
  await fs.writeFile(path.join(f.project, "legacy.bin"), Buffer.from([0x61]));
  await assert.rejects(run(assertTargetUnchanged(plan.snapshot)), /Target changed/);
});

test("matching rerun preserves all bytes and permission bits, and needs no confirmation", async (t) => {
  const f = await setup(t);
  const resolved = await f.resolve();
  const first = await run(planProject(f.project, resolved));
  // Test-fixture materialization only; the production seam never applies plans.
  for (const file of first.files) if (file.after.kind === "file") {
    await fs.writeFile(path.join(f.project, file.path), Buffer.from(file.after.base64, "base64"), { mode: file.after.mode });
  }
  await f.writeProject("package.json", ' { "scripts": { "install": "exit 99" }, "devDependencies": {"oxlint":"1.0.0"}, "name":"untouched" }\n');
  await f.writeProject(".oxlintrc.json", '{/* keep local layout */"rules":{"no-debugger":"error"}}\n');
  await fs.chmod(path.join(f.project, ".oxlintrc.json"), 0o600);
  const before = await snapshot(f.project);
  const again = await run(planProject(f.project, resolved, { previous: resolved.intent, currentBundles: resolved.policy.bundles }));
  assert.deepEqual(changed(again), []);
  assert.equal(again.requiresConfirmation, false);
  for (const file of again.files) assert.deepEqual(file.after, file.before);
  assert.deepEqual(await snapshot(f.project), before);
});

test("scripts have an ordinary-manifest adapter; absent adapters defer rather than silently lose work", async (t) => {
  const f = await fixture(t);
  const resolved = await run(resolveInputs(await run(loadPolicy(f.policy, empty)), {}));
  const plan = await run(planProject(f.project, resolved));
  assert.equal(plan.complete, false);
  assert.match(plan.deferred[0]!.path, /scripts.check/);
  assert.deepEqual(value(plan, "package.json").scripts, { install: "exit 99" });
  const adapted = await run(planProject(f.project, resolved, { scripts: ({ manifest, selected, deselected }) => {
    assert.equal(selected[0]!.declaration.scripts!.check, "oxlint .");
    assert.deepEqual(deselected, []);
    return Effect.succeed({ ...(manifest.scripts as Record<string, string>), placeholder: "adapter-owned result" });
  } }));
  assert.equal(adapted.complete, true);
  assert.deepEqual(value(adapted, "package.json").scripts, { install: "exit 99", placeholder: "adapter-owned result" });
});

test("unrelated workflows block automation planning rather than becoming replaceable dedicated configuration", async (t) => {
  const f = await setup(t);
  await f.add("automation/ci", { name: "CI", migration: { removeFiles: [".github/workflows/old.yml"] } });
  await f.write("typescript/automation/ci/files/.github/workflows/check.yml", "# its-checks: managed\nname: checks\non: push\n");
  await f.writeProject(".github/workflows/check.yml", "name: unrelated\non: push\n");
  await f.writeProject(".husky/pre-commit", "echo unrelated\n");
  const selected = await f.resolve({ integrations: [], automation: ["ci"] });
  const before = await snapshot(f.project);
  await assert.rejects(run(planProject(f.project, selected)), /Unrelated content.*Move or rename/);
  await assert.rejects(run(planProject(f.project, await f.resolve(), { previous: selected.intent, currentBundles: selected.policy.bundles })), /Unrelated content/);
  assert.deepEqual(await snapshot(f.project), before);
});

test("malformed manifests fail with typed target diagnostics before mutation", async (t) => {
  for (const content of ['{"name":', '{"name":"a","name":"b"}', '[]', '{"dependencies":[]}', '{"scripts":{"check":3}}', '{"devDependencies":{"x":null}}']) {
    await t.test(content, async (t) => {
      const f = await setup(t);
      await f.writeProject("package.json", content);
      const before = await snapshot(f.project);
      await assert.rejects(run(planProject(f.project, await f.resolve())), /package.json/);
      assert.deepEqual(await snapshot(f.project), before);
    });
  }
});

test("target symlinks, nonregular destinations, unsafe paths and case aliases fail without traversing them", async (t) => {
  for (const relative of ["package.json", ".oxlintrc.json", "oxlint.config.ts"]) await t.test(relative, async (t) => {
    const f = await setup(t);
    await fs.rm(path.join(f.project, relative), { force: true });
    await fs.symlink(path.join(f.root, "outside"), path.join(f.project, relative));
    await assert.rejects(run(planProject(f.project, await f.resolve())), /symlinks are forbidden/);
  });
  const f = await setup(t);
  const rootLink = path.join(f.root, "project-link");
  await fs.symlink(f.project, rootLink);
  await assert.rejects(run(planProject(rootLink, await f.resolve())), /regular directory/);
  await f.write("typescript/base/files/nested/config.json", {});
  await fs.symlink(f.root, path.join(f.project, "nested"));
  await assert.rejects(run(planProject(f.project, await f.resolve())), /symlinks are forbidden/);
  await assert.rejects(run(readTargetSnapshot(f.project, ["../outside"])), /Unsafe/);
  await assert.rejects(run(readTargetSnapshot(f.project, ["A.json", "a.json"])), /Case-alias/);
  await assert.rejects(run(readTargetSnapshot(f.project, ["A/one.json", "a/two.json"])), /Case-alias/);
  await assert.rejects(run(readTargetSnapshot(f.project, ["new", "new/file.json"])), /also used as a parent/);
  await fs.mkdir(path.join(f.project, ".oxlintrc.json"));
  await assert.rejects(run(readTargetSnapshot(f.project, [".oxlintrc.json"])), /regular file/);
});

test("invalid composition shapes and policy/removal collisions fail with native source context", async (t) => {
  const f = await setup(t);
  await f.write("typescript/base/files/.oxlintrc.json", { rules: [] });
  await assert.rejects(run(planProject(f.project, await f.resolve())), /\.oxlintrc.json: rules: Expected an object/);
  await f.write("typescript/base/files/.oxlintrc.json", { plugins: {} });
  await assert.rejects(run(planProject(f.project, await f.resolve())), /plugins: Expected an array/);
  await f.write("typescript/base/files/.oxlintrc.json", {});
  await f.write("typescript/base/files/.oxfmtrc.json", { extends: ["unverified"] });
  await assert.rejects(run(planProject(f.project, await f.resolve())), /Oxfmt extends/);
  await fs.rm(path.join(f.policy, "typescript/base/files/.oxfmtrc.json"));
  await f.add("base", { name: "Base", migration: { removeFiles: [".oxlintrc.json"] } });
  await assert.rejects(run(planProject(f.project, await f.resolve())), /Cannot remove selected output/);
});
