import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { stringify } from "yaml";
import { loadPolicy } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject } from "../src/planning.ts";
import { applyPlan, ApplicationError, OperationError } from "../src/application.ts";
import { resolveTargetManager, createDependencyAdapter, testedVersions, type ManagerOperations } from "../src/package-managers.ts";
import type { PackageManager } from "../src/scripts.ts";
import { fixture } from "./fixtures.ts";

const run = Effect.runPromise;
const put = async (root: string, file: string, value: string | object) => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value));
};
const get = async (root: string, file: string) => JSON.parse(await fs.readFile(path.join(root, file), "utf8"));

test("manager evidence asks on absent, malformed, conflicting declarations/locks; explicit answer feeds script planning", async (t) => {
  const f = await fixture(t);
  assert.equal((await run(resolveTargetManager(f.project))).kind, "question");
  for (const manager of Object.keys(testedVersions) as PackageManager[]) {
    await put(f.project, "package.json", { packageManager: `${manager}@${testedVersions[manager]}` });
    const resolved = await run(resolveTargetManager(f.project));
    assert.equal(resolved.kind, "resolved");
    if (resolved.kind === "resolved") assert.equal(resolved.target.manager, manager);
  }
  for (const [lock, manager] of [["package-lock.json", "npm"], ["npm-shrinkwrap.json", "npm"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"]]) {
    await put(f.project, "package.json", {});
    await put(f.project, lock!, "lock evidence only; never executed");
    const resolved = await run(resolveTargetManager(f.project));
    assert.equal(resolved.kind === "resolved" && resolved.target.manager, manager);
    await fs.unlink(path.join(f.project, lock!));
  }
  await put(f.project, "package.json", { packageManager: "npm@11.19.0" });
  await put(f.project, "yarn.lock", "");
  let resolution = await run(resolveTargetManager(f.project));
  assert.equal(resolution.kind, "question");
  if (resolution.kind === "question") assert.deepEqual(resolution.evidence, ["packageManager: npm@11.19.0", "yarn.lock"]);
  resolution = await run(resolveTargetManager(f.project, "pnpm"));
  assert.equal(resolution.kind, "resolved");
  if (resolution.kind !== "resolved") throw Error("Expected explicit answer");
  const resolved = await run(resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {}));
  const plan = await run(planProject(f.project, resolved, { scripts: resolution.target.scripts }));
  const state = plan.files.find((file) => file.path === "package.json")!.after;
  assert.equal(state.kind, "file");
  if (state.kind !== "file") throw Error("Expected manifest");
  const manifest = JSON.parse(Buffer.from(state.base64, "base64").toString());
  assert.equal(manifest.scripts.check, "pnpm run its-checks:check");
  await put(f.project, "package.json", { packageManager: "unknown@1" });
  assert.equal((await run(resolveTargetManager(f.project))).kind, "question");
  assert.equal(await fs.readFile(path.join(f.project, "yarn.lock"), "utf8"), "", "conflicting lock evidence is never deleted");
});

/** Independent native-state fixture formats; the fake process owns consequential installation effects. */
async function installed(root: string, manager: PackageManager) {
  const manifest = await get(root, "package.json");
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  const importer: Record<string, unknown> = {};
  const packages: Record<string, unknown> = {};
  const yarnEntries: Record<string, string> = {};
  let yarn = "# yarn lockfile v1\n\n";
  for (const section of ["dependencies", "devDependencies"] as const) importer[section] = Object.fromEntries(
    Object.entries(manifest[section] ?? {}).map(([name, spec]) => [name, { specifier: spec, version: spec }]));
  for (const [name, version] of Object.entries(deps) as [string, string][]) {
    const location = `node_modules/${name}`;
    if (manager === "bun") {
      await put(root, `node_modules/.bun/${name}@${version}/node_modules/${name}/package.json`, { name, version });
      await fs.unlink(path.join(root, location)).catch((cause) => { if (cause.code !== "ENOENT") throw cause; });
      await fs.symlink(`.bun/${name}@${version}/node_modules/${name}`, path.join(root, location));
    } else await put(root, `${location}/package.json`, { name, version });
    if (manager === "npm") packages[location] = { version };
    if (manager === "pnpm") packages[`${name}@${version}`] = { resolution: { integrity: "fixture" } };
    if (manager === "yarn") {
      yarn += `${JSON.stringify(`${name}@${version}`)}:\n  version ${JSON.stringify(version)}\n  resolved ${JSON.stringify(`https://fixture.invalid/${name}-${version}.tgz`)}\n\n`;
      yarnEntries[`${name}@${version}`] = `https://fixture.invalid/${name}-${version}.tgz`;
    }
    if (manager === "bun") packages[name] = [`${name}@${version}`, "", {}, "fixture"];
  }
  if (manager === "npm") {
    await put(root, "package-lock.json", { lockfileVersion: 3, packages: { "": { dependencies: manifest.dependencies, devDependencies: manifest.devDependencies }, ...packages } });
    await put(root, "node_modules/.package-lock.json", { lockfileVersion: 3, packages });
  }
  if (manager === "pnpm") {
    const lock = stringify({ lockfileVersion: "9.0", settings: {}, importers: { ".": importer }, packages });
    await put(root, "pnpm-lock.yaml", lock);
    await put(root, "node_modules/.pnpm/lock.yaml", lock);
    await put(root, "node_modules/.modules.yaml", "layoutVersion: 5\n");
  }
  if (manager === "yarn") {
    await put(root, "yarn.lock", yarn);
    await put(root, "node_modules/.yarn-integrity", { topLevelPatterns: Object.keys(yarnEntries), lockfileEntries: yarnEntries });
  }
  if (manager === "bun") await put(root, "bun.lock", { lockfileVersion: 2, workspaces: { "": {
    dependencies: manifest.dependencies, devDependencies: manifest.devDependencies } }, packages });
}

for (const manager of Object.keys(testedVersions) as PackageManager[]) test(`${manager}: application through process seam preserves manifest, no-ops, rejects stale state, retains intent and retries failure`, async (t) => {
  const f = await fixture(t);
  // The shared fixture's install: exit 99 is deliberately preserved but NEVER executed by the process substitute.
  await put(f.project, "package.json", { name: "app", private: true, packageManager: `${manager}@${testedVersions[manager]}`,
    scripts: { install: "exit 99", custom: "echo keep" }, devDependencies: { unrelated: "1.0.0" }, custom: true });
  if (manager === "bun") await put(f.project, "bunfig.toml", '[install]\nlinker = "isolated"\n');
  if (manager === "pnpm") await put(f.project, ".npmrc", 'manage-package-manager-versions=false\n');
  await f.add("base", { name: "Base", devDependencies: { managed: "1.0.0" }, scripts: { check: "echo managed" } });
  const resolution = await run(resolveTargetManager(f.project));
  assert.equal(resolution.kind, "resolved");
  if (resolution.kind !== "resolved") throw Error("Expected manager");
  let installs = 0, fail = false;
  const operations: ManagerOperations = { run: (_command, args) => {
    if (args[0] === "--version") return Effect.succeed({ code: 0, stdout: testedVersions[manager], stderr: "" });
    if (args[0] === "config") return Effect.succeed({ code: 0, stdout: "false", stderr: "" });
    assert.deepEqual(args, ["install"], "normal manager install, no add/remove/ignore-scripts flags");
    return Effect.tryPromise({ try: async () => {
      installs++;
      assert.equal((await get(f.project, ".oxlintrc.json")).rules["no-debugger"], "error");
      assert.ok((await get(f.project, ".its-checks.json")).source);
      await installed(f.project, manager);
      return { code: fail ? 42 : 0, stdout: "dependencies materialized", stderr: fail ? "root lifecycle failed" : "" };
    }, catch: (cause) => { throw cause; } });
  } };
  const adapter = createDependencyAdapter(resolution.target, operations);
  let commit: string | undefined;
  const plan = async () => run(planProject(f.project, await run(resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {}, commit)), { scripts: resolution.target.scripts }));
  let next = await plan();
  assert.equal(await run(adapter.assess(next)), "required");
  assert.equal(installs, 0, "assessment is read-only");
  assert.equal((await run(applyPlan(next, { approved: true, dependencies: adapter }))).dependencyWork, "completed");
  next = await plan();
  assert.equal((await run(applyPlan(next, { approved: true, dependencies: adapter }))).dependencyWork, "not-required");
  assert.equal(installs, 1);
  assert.equal((await get(f.project, "package.json")).scripts.install, "exit 99");
  assert.equal((await get(f.project, "package.json")).devDependencies.unrelated, "1.0.0");
  for (const revision of ["a".repeat(40), "b".repeat(40)]) {
    commit = revision;
    const provenance = await plan();
    assert.deepEqual(provenance.files.filter((file) => file.kind !== "noop").map((file) => file.path), [".its-checks.json"]);
    assert.equal(await run(adapter.assess(provenance)), "not-required", "source identity is not dependency/lifecycle evidence");
    assert.equal((await run(applyPlan(provenance, { approved: true, dependencies: adapter }))).dependencyWork, "not-required");
    assert.equal(installs, 1);
  }
  // Formatting/mtime, object order, unrelated values and non-lifecycle commands
  // are not evidence that dependency installation or lifecycle execution is due.
  for (const rewrite of [
    (value: Record<string, any>) => JSON.stringify(value, null, 4) + "\n\n",
    (value: Record<string, any>) => JSON.stringify(Object.fromEntries(Object.entries(value).reverse())),
    (value: Record<string, any>) => JSON.stringify({ ...value, description: "unrelated edit", scripts: { ...value.scripts, custom: "echo changed" } }),
  ]) {
    const approved = await plan();
    await put(f.project, "package.json", rewrite(await get(f.project, "package.json")));
    const newer = new Date(Date.now() + 2000);
    await fs.utimes(path.join(f.project, "package.json"), newer, newer);
    assert.equal(await run(adapter.assess(approved)), "not-required", "semantic preview is distinct from exact application approval");
    const stale = await run(applyPlan(approved, { approved: true, dependencies: adapter }).pipe(Effect.match({
      onFailure: (error) => error.message, onSuccess: () => "unexpected success" })));
    assert.match(stale, /Target changed since planning/);
    const unapproved = await run(adapter.install(approved).pipe(Effect.match({
      onFailure: (error) => error.message, onSuccess: () => "unexpected success" })));
    assert.match(unapproved, /exact approved target manifest/);
    const matching = await plan();
    assert.ok(matching.files.every((file) => file.kind === "noop"));
    assert.equal(await run(adapter.assess(matching)), "not-required");
    const report = await run(applyPlan(matching, { approved: true, dependencies: adapter }));
    assert.equal(report.dependencyWork, "not-required");
    assert.ok(report.completed.every((operation) => operation.kind === "assess-dependencies"));
    assert.equal((await run(applyPlan(await plan(), { approved: true, dependencies: adapter }))).dependencyWork, "not-required");
    assert.equal(installs, 1);
  }
  // Saved intent is identical; actual installed version drift still requires installation.
  const pkg = path.join(f.project, "node_modules/managed/package.json");
  await fs.writeFile(pkg, '{"name":"managed","version":"0.0.1"}');
  assert.equal(await run(adapter.assess(await plan())), "required");
  fail = true;
  const failed = await run(applyPlan(await plan(), { approved: true, dependencies: adapter }).pipe(Effect.match({ onFailure: (error) => error,
    onSuccess: () => { throw Error("Expected failure"); } })));
  assert.ok(failed instanceof ApplicationError);
  assert.equal(failed.phase, "dependencies");
  assert.match(failed.message, /root lifecycle failed/);
  assert.match(failed.message, /next assessment requires installation/);
  assert.ok(await get(f.project, ".its-checks.json"));
  assert.equal(await run(adapter.assess(await plan())), "required");
  fail = false;
  assert.equal((await run(applyPlan(await plan(), { approved: true, dependencies: adapter }))).dependencyWork, "completed");
  assert.equal((await run(applyPlan(await plan(), { approved: true, dependencies: adapter }))).dependencyWork, "not-required");
  assert.equal(installs, 3);
  // Never install a manifest changed after approval, even if only unrelated fields changed.
  next = await plan();
  const current = await get(f.project, "package.json");
  await put(f.project, "package.json", { ...current, custom: false });
  const rejected = await run(adapter.install(next).pipe(Effect.match({ onFailure: (e) => e.message, onSuccess: () => "unexpected" })));
  assert.match(rejected, /exact approved target manifest/);
  assert.equal(installs, 3);
  await put(f.project, "package.json", current);
  await fs.rm(path.join(f.project, "node_modules/managed"), { recursive: true, force: true });
  // An exit-zero subprocess is not proof of the requested installed state.
  const noWork = createDependencyAdapter(resolution.target, { run: (_cmd, args) => Effect.succeed({ code: 0,
    stdout: args[0] === "--version" ? testedVersions[manager] : args[0] === "config" ? "false" : "pretend success", stderr: "" }) });
  const unsuccessful = await run(applyPlan(await plan(), { approved: true, dependencies: noWork }).pipe(Effect.match({
    onFailure: (error) => error.message, onSuccess: () => "unexpected success" })));
  assert.match(unsuccessful, /returned success but actual installation/);
  const crashed = createDependencyAdapter(resolution.target, { run: (_cmd, args) => args[0] === "install"
    ? Effect.fail(new OperationError({ detail: "spawn failed after partial work" }))
    : Effect.succeed({ code: 0, stdout: args[0] === "--version" ? testedVersions[manager] : "false", stderr: "" }) });
  const crash = await run(applyPlan(await plan(), { approved: true, dependencies: crashed }).pipe(Effect.match({
    onFailure: (error) => error.message, onSuccess: () => "unexpected success" })));
  assert.match(crash, /spawn failed after partial work/);
  assert.match(crash, /next assessment requires installation|retry cannot be guaranteed/);
  if (manager === "bun") assert.match(crash, /Bun recovery BLOCKED: no approved direct dependency symlink/);
});

for (const manager of Object.keys(testedVersions) as PackageManager[]) test(`${manager}: lifecycle command/helper changes require execution, unrelated script changes do not`, async (t) => {
  const f = await fixture(t);
  await put(f.project, "package.json", { name: "lifecycle", packageManager: `${manager}@${testedVersions[manager]}` });
  if (manager === "bun") await put(f.project, "bunfig.toml", '[install]\nlinker = "isolated"\n');
  if (manager === "pnpm") await put(f.project, ".npmrc", "manage-package-manager-versions=false\n");
  const declaration = (scripts: Record<string, string>) => ({ name: "Base", devDependencies: { managed: "1.0.0" }, scripts });
  await f.add("base", declaration({ check: "echo check" }));
  const resolution = await run(resolveTargetManager(f.project));
  if (resolution.kind !== "resolved") throw Error("Expected manager");
  let installs = 0;
  const adapter = createDependencyAdapter(resolution.target, { run: (_command, args) => {
    if (args[0] !== "install") return Effect.succeed({ code: 0, stdout: args[0] === "--version" ? testedVersions[manager] : "false", stderr: "" });
    return Effect.tryPromise({ try: async () => {
      installs++;
      await installed(f.project, manager);
      return { code: 0, stdout: "", stderr: "" };
    }, catch: (cause) => { throw cause; } });
  } });
  const plan = async () => run(planProject(f.project, await run(resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {})), { scripts: resolution.target.scripts }));
  const apply = async () => run(applyPlan(await plan(), { approved: true, dependencies: adapter }));
  assert.equal((await apply()).dependencyWork, "completed");
  for (const prepare of ["echo first", "echo second"]) {
    const priorWrapper = (await get(f.project, "package.json")).scripts.prepare;
    await f.add("base", declaration({ check: "echo check", prepare }));
    const next = await plan();
    assert.equal(await run(adapter.assess(next)), "required");
    assert.equal((await run(applyPlan(next, { approved: true, dependencies: adapter }))).dependencyWork, "completed");
    if (prepare === "echo second") assert.equal((await get(f.project, "package.json")).scripts.prepare, priorWrapper, "only the generated helper changed");
    assert.equal((await apply()).dependencyWork, "not-required");
  }
  await f.add("base", declaration({ check: "echo unrelated change", prepare: "echo second" }));
  const unrelated = await plan();
  assert.equal(await run(adapter.assess(unrelated)), "not-required");
  assert.equal((await run(applyPlan(unrelated, { approved: true, dependencies: adapter }))).dependencyWork, "not-required");
  assert.equal(installs, 3);
});

test("npm accepts a migrated incidental package only at a native lock-tracked location", async (t) => {
  const f = await fixture(t);
  await put(f.project, "package.json", { packageManager: `npm@${testedVersions.npm}`, devDependencies: { remaining: "1.0.0" } });
  await f.add("base", { name: "Base", migration: { removeDevDependencies: ["incidental"] } });
  const resolution = await run(resolveTargetManager(f.project));
  if (resolution.kind !== "resolved") throw Error("Expected npm");
  const adapter = createDependencyAdapter(resolution.target, { run: (_command, args) => args[0] === "install"
    ? Effect.promise(async () => { await installed(f.project, "npm"); return { code: 0, stdout: "", stderr: "" }; })
    : Effect.succeed({ code: 0, stdout: args[0] === "--version" ? testedVersions.npm : "false", stderr: "" }) });
  const plan = async () => run(planProject(f.project, await run(resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {})), { scripts: resolution.target.scripts }));
  assert.equal((await run(applyPlan(await plan(), { approved: true, dependencies: adapter }))).dependencyWork, "completed");
  const lock = await get(f.project, "package-lock.json");
  lock.packages["node_modules/remaining"].dependencies = { incidental: "1.0.0" };
  lock.packages["node_modules/remaining/node_modules/incidental"] = { version: "1.0.0" };
  const sync = async () => {
    await put(f.project, "package-lock.json", lock);
    const { "": _root, ...packages } = lock.packages;
    await put(f.project, "node_modules/.package-lock.json", { lockfileVersion: 3, packages });
  };
  await put(f.project, "node_modules/remaining/node_modules/incidental/package.json", { name: "incidental", version: "1.0.0" });
  await sync();
  assert.equal(await run(adapter.assess(await plan())), "not-required");
  await put(f.project, "node_modules/incidental/package.json", { name: "incidental", version: "1.0.0" });
  assert.equal(await run(adapter.assess(await plan())), "required", "a nested reference does not justify an untracked stale root copy");
  await fs.rm(path.join(f.project, "node_modules/remaining/node_modules/incidental"), { recursive: true });
  delete lock.packages["node_modules/remaining/node_modules/incidental"];
  lock.packages["node_modules/incidental"] = { version: "1.0.0" };
  await sync();
  assert.equal(await run(adapter.assess(await plan())), "not-required", "native lock and inventory justify the hoisted copy");
  await put(f.project, "node_modules/incidental/package.json", { name: "incidental", version: "0.0.1" });
  assert.equal(await run(adapter.assess(await plan())), "required", "incidental presence does not bypass installed-version checks");
});

test("Yarn checks the native locked version of a migrated hoisted dependency", async (t) => {
  const f = await fixture(t);
  await put(f.project, "package.json", { packageManager: `yarn@${testedVersions.yarn}`, devDependencies: { remaining: "1.0.0" } });
  await f.add("base", { name: "Base", migration: { removeDevDependencies: ["incidental"] } });
  const resolution = await run(resolveTargetManager(f.project));
  if (resolution.kind !== "resolved") throw Error("Expected Yarn");
  const adapter = createDependencyAdapter(resolution.target, { run: (_command, args) => args[0] === "install"
    ? Effect.promise(async () => { await installed(f.project, "yarn"); return { code: 0, stdout: "", stderr: "" }; })
    : Effect.succeed({ code: 0, stdout: args[0] === "--version" ? testedVersions.yarn : "false", stderr: "" }) });
  const plan = async () => run(planProject(f.project, await run(resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {})), { scripts: resolution.target.scripts }));
  assert.equal((await run(applyPlan(await plan(), { approved: true, dependencies: adapter }))).dependencyWork, "completed");
  await put(f.project, "yarn.lock", '# yarn lockfile v1\n\n"remaining@1.0.0":\n  version "1.0.0"\n  resolved "https://fixture.invalid/remaining-1.0.0.tgz"\n  dependencies:\n    incidental "1.0.0"\n\n"incidental@1.0.0":\n  version "1.0.0"\n  resolved "https://fixture.invalid/incidental-1.0.0.tgz"\n');
  await put(f.project, "node_modules/.yarn-integrity", { topLevelPatterns: ["remaining@1.0.0"], lockfileEntries: {
    "remaining@1.0.0": "https://fixture.invalid/remaining-1.0.0.tgz", "incidental@1.0.0": "https://fixture.invalid/incidental-1.0.0.tgz",
  } });
  await put(f.project, "node_modules/incidental/package.json", { name: "incidental", version: "1.0.0" });
  assert.equal(await run(adapter.assess(await plan())), "not-required");
  await put(f.project, "node_modules/incidental/package.json", { name: "incidental", version: "0.0.1" });
  assert.equal(await run(adapter.assess(await plan())), "required", "incidental hoisting does not justify an incorrect installed version");
});

test("Bun failure reconciles only approved removed store links and reports partial effects", async (t) => {
  const f = await fixture(t);
  const removed = ["removed", "external", "regular", "peer", "optional"];
  await put(f.project, "package.json", { packageManager: `bun@${testedVersions.bun}`,
    devDependencies: Object.fromEntries([...removed, "retained"].map((name) => [name, "1.0.0"])),
    peerDependencies: { peer: "1.0.0" }, optionalDependencies: { optional: "1.0.0" } });
  await put(f.project, "bunfig.toml", '[install]\nlinker = "isolated"\n');
  await installed(f.project, "bun");
  const storeTarget = await fs.realpath(path.join(f.project, "node_modules/removed"));
  const storeBytes = await fs.readFile(path.join(storeTarget, "package.json"));
  await fs.symlink(await fs.readlink(path.join(f.project, "node_modules/removed")), path.join(f.project, "node_modules/unlisted"));
  await fs.unlink(path.join(f.project, "node_modules/external"));
  await put(f.project, "external/package.json", { name: "external", version: "1.0.0" });
  await fs.symlink("../external", path.join(f.project, "node_modules/external"));
  await fs.unlink(path.join(f.project, "node_modules/regular"));
  await put(f.project, "node_modules/regular/package.json", { name: "regular", version: "1.0.0" });
  const preserved = ["external", "regular", "peer", "optional", "unlisted"];
  const before = await Promise.all(preserved.map((name) => fs.readFile(path.join(f.project, "node_modules", name, "package.json"))));
  await f.add("base", { name: "Base", migration: { removeDevDependencies: removed } });
  const resolution = await run(resolveTargetManager(f.project));
  if (resolution.kind !== "resolved") throw Error("Expected Bun");
  const lock = await fs.readFile(path.join(f.project, "bun.lock"));
  const adapter = createDependencyAdapter(resolution.target, { run: (_cmd, args) => Effect.succeed({
    code: args[0] === "install" ? 42 : 0, stdout: args[0] === "--version" ? testedVersions.bun : "",
    stderr: args[0] === "install" ? "late lifecycle failure" : "" }) });
  const plan = await run(planProject(f.project, await run(resolveInputs(await run(loadPolicy(f.policy, { integrations: [], automation: [] })), {})), {
    scripts: resolution.target.scripts }));
  const failure = await run(applyPlan(plan, { approved: true, dependencies: adapter }).pipe(Effect.match({
    onSuccess: () => { throw Error("Expected failure"); }, onFailure: (error) => error })));
  assert.ok(failure instanceof ApplicationError);
  assert.match(failure.message, /late lifecycle failure/);
  assert.match(failure.message, /Unlinked approved removed dependencies node_modules\/removed \(store targets preserved\)/);
  assert.match(failure.message, /no rollback/);
  await assert.rejects(fs.lstat(path.join(f.project, "node_modules/removed")), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile(path.join(storeTarget, "package.json")), storeBytes);
  for (const [index, name] of preserved.entries()) {
    assert.deepEqual(await fs.readFile(path.join(f.project, "node_modules", name, "package.json")), before[index]);
    assert.equal((await fs.lstat(path.join(f.project, "node_modules", name))).isSymbolicLink(), name !== "regular");
  }
  assert.deepEqual(await fs.readFile(path.join(f.project, "bun.lock")), lock, "authored lock is not invalidated");
});
