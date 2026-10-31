import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { test } from "node:test";
import { Effect } from "effect";
import { loadPolicy } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject } from "../src/planning.ts";
import { loadPreviousIntent } from "../src/selections.ts";
import { applyPlan, ApplicationError } from "../src/application.ts";
import { createDependencyAdapter, resolveTargetManager, testedVersions, nodeManagerOperations } from "../src/package-managers.ts";
import type { PackageManager } from "../src/scripts.ts";

const run = Effect.runPromise;
const empty = { integrations: [], automation: [] };
// All fixture scripts are authored here and inspected: local Node filesystem operations only.
// Archives have NO scripts, network references or bin entries; dependencies below
// reference only authored local archives. Never use shared fixture install: exit 99.
const lifecycle = `node -e 'const f=require("node:fs"); if(!f.existsSync(".oxlintrc.json"))process.exit(81); f.appendFileSync("lifecycle.log","postinstall\\n"); if(f.existsSync("fail-lifecycle"))process.exit(42)'`;
const original = `node -e 'require("node:fs").appendFileSync("commands.log","original\\n")'`;
const helper = `node -e 'require("node:fs").appendFileSync("commands.log","helper\\n")'`;

for (const manager of Object.keys(testedVersions) as PackageManager[]) test(`${manager} ${testedVersions[manager]}: real install/update/remove/no-op/stale/failure/retry/lifecycle/wrappers`, { timeout: 120_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `its-checks-real-${manager}-`));
  t.after(() => process.env.ITS_CHECKS_KEEP_FIXTURES ? console.error(`Fixture: ${root}`) : fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), policy = path.join(root, "policy");
  const put = async (name: string, value: string | object) => {
    await fs.mkdir(path.dirname(name), { recursive: true });
    await fs.writeFile(name, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  };
  for (const [name, version, archive] of [["managed-dep", "1.0.0", "one"], ["managed-dep", "2.0.0", "two"], ["unrelated-dep", "1.0.0", "keep"]]) {
    const dir = path.join(root, archive!, "package");
    await put(path.join(dir, "package.json"), { name, version });
    const tar = await run(nodeManagerOperations.run("tar", ["-czf", path.join(root, `${archive}.tgz`), "-C", path.dirname(dir), "package"], root));
    assert.equal(tar.code, 0, tar.stderr);
  }
  await put(path.join(project, "package.json"), { name: "real-project", private: true,
    packageManager: `${manager}@${testedVersions[manager]}`, scripts: { postinstall: lifecycle, check: original },
    devDependencies: { "unrelated-dep": "file:../keep.tgz" }, custom: { preserved: true } });
  if (manager === "pnpm") await put(path.join(project, ".npmrc"), "manage-package-manager-versions=false\n");
  if (manager === "yarn") await put(path.join(project, ".yarnrc"), 'disable-self-update-check true\n');
  if (manager === "bun") await put(path.join(project, "bunfig.toml"), '[install]\nlinker = "isolated"\n');
  await put(path.join(policy, "bundle.json"), { schemaVersion: 1, source: {
    repository: "https://github.com/example/fork", revision: "a".repeat(40), selectionSchema: "schemas/selections.schema.json" } });
  let selected = manager === "bun" ? { integrations: ["managed"], automation: [] } : empty;
  const declaration = (version: string | null) => ({ name: "Base", scripts: { check: helper },
    ...(manager === "bun" ? {} : version ? { devDependencies: { "managed-dep": `file:../${version}.tgz` } }
      : { migration: { removeDevDependencies: ["managed-dep"] } }) });
  if (manager === "bun") await put(path.join(policy, "typescript/integrations/managed/bundle.json"), {
    name: "Managed", devDependencies: { "managed-dep": "file:../one.tgz" } });
  await put(path.join(policy, "typescript/base/bundle.json"), declaration("one"));
  await put(path.join(policy, "typescript/base/files/.oxlintrc.json"), { rules: { "no-debugger": "error" } });
  const resolution = await run(resolveTargetManager(project));
  assert.equal(resolution.kind, "resolved");
  if (resolution.kind !== "resolved") throw Error("Expected resolution");
  const calls: string[][] = [];
  const adapter = createDependencyAdapter(resolution.target, { run: (cmd, args, cwd) => {
    calls.push([cmd, ...args]); return nodeManagerOperations.run(cmd, args, cwd);
  } });
  const plan = async () => {
    const previous = await run(loadPreviousIntent(project));
    const currentBundles = previous ? (await run(loadPolicy(policy, previous))).bundles : [];
    return run(planProject(project, await run(resolveInputs(await run(loadPolicy(policy, selected)), {})), {
      scripts: resolution.target.scripts, ...(previous ? { previous } : {}), currentBundles }));
  };
  const apply = async () => run(applyPlan(await plan(), { approved: true, dependencies: adapter }));
  const count = () => calls.filter((args) => args[1] === "install").length;
  const log = () => fs.readFile(path.join(project, "lifecycle.log"), "utf8");
  const version = async (name = "managed-dep") => JSON.parse(await fs.readFile(path.join(project, "node_modules", name, "package.json"), "utf8")).version;
  assert.equal(await run(adapter.assess(await plan())), "required", "read-only preview sees missing install");
  assert.equal(count(), 0);
  assert.equal((await apply()).dependencyWork, "completed");
  assert.equal(await version(), "1.0.0");
  assert.equal(await version("unrelated-dep"), "1.0.0");
  assert.equal(await log(), "postinstall\n");
  // Native runners execute generated wrappers and preserve original commands.
  const check = await run(nodeManagerOperations.run(manager, ["run", "check"], project));
  assert.equal(check.code, 0, check.stderr);
  assert.equal(await fs.readFile(path.join(project, "commands.log"), "utf8"), "original\nhelper\n");
  const beforeNoop = count();
  assert.equal((await apply()).dependencyWork, "not-required");
  assert.equal(count(), beforeNoop);
  assert.equal(await log(), "postinstall\n");
  // Independent of Oxfmt: whitespace, key order and a newer mtime must not
  // invalidate any manager's otherwise matching native lock/tree/inventory.
  for (const layout of ["whitespace", "key-order"]) {
    const file = path.join(project, "package.json");
    const manifest = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(file, layout === "whitespace" ? JSON.stringify(manifest, null, 4) + "\n\n"
      : JSON.stringify(Object.fromEntries(Object.entries(manifest).reverse())) + "\n");
    const newer = new Date(Date.now() + 2000);
    await fs.utimes(file, newer, newer);
    for (let rerun = 0; rerun < 2; rerun++) {
      const matching = await plan();
      assert.ok(matching.files.every((entry) => entry.kind === "noop"));
      assert.equal(await run(adapter.assess(matching)), "not-required");
      const report = await run(applyPlan(matching, { approved: true, dependencies: adapter }));
      assert.equal(report.dependencyWork, "not-required");
      assert.ok(report.completed.every((entry) => entry.kind === "assess-dependencies"));
      assert.equal(count(), beforeNoop);
      assert.equal(await log(), "postinstall\n");
    }
  }
  await put(path.join(policy, "typescript/base/bundle.json"), declaration("two"));
  if (manager === "bun") await put(path.join(policy, "typescript/integrations/managed/bundle.json"), {
    name: "Managed", devDependencies: { "managed-dep": "file:../two.tgz" } });
  assert.equal((await apply()).dependencyWork, "completed");
  assert.equal(await version(), "2.0.0");
  assert.equal(await log(), "postinstall\npostinstall\n");
  // Replace (do not truncate a potentially hardlinked store file) to bound corruption to this fixture.
  const installedManifest = path.join(project, "node_modules/managed-dep/package.json");
  const installedBytes = await fs.readFile(installedManifest);
  await fs.unlink(installedManifest);
  await fs.writeFile(installedManifest, '{"name":"managed-dep","version":"0.0.1"}');
  assert.equal(await run(adapter.assess(await plan())), "required");
  await fs.writeFile(installedManifest, installedBytes);
  // Lock drift cannot be hidden by matching selections/manifest/tree.
  const lockName = { npm: "package-lock.json", pnpm: "pnpm-lock.yaml", yarn: "yarn.lock", bun: "bun.lock" }[manager];
  const lock = await fs.readFile(path.join(project, lockName), "utf8");
  await fs.writeFile(path.join(project, lockName), lock.replaceAll("two.tgz", "one.tgz"));
  assert.equal(await run(adapter.assess(await plan())), "required");
  await fs.writeFile(path.join(project, lockName), lock);
  // Resolution-only drift must not be hidden by an unchanged importer/manifest requirement.
  const staleResolution = manager === "npm" ? (() => {
    const value = JSON.parse(lock); value.packages["node_modules/managed-dep"].resolved = "file:../one.tgz"; return JSON.stringify(value);
  })() : manager === "pnpm" ? lock.replace("tarball: file:../two.tgz", "tarball: file:../one.tgz")
    : manager === "yarn" ? lock.replace('resolved "file:../two.tgz', 'resolved "file:../one.tgz')
      : lock.replace('"managed-dep@../two.tgz"', '"managed-dep@../one.tgz"');
  assert.notEqual(staleResolution, lock, "fixture actually changed a resolution, not the requested specifier");
  await fs.writeFile(path.join(project, lockName), staleResolution);
  assert.equal(await run(adapter.assess(await plan())), "required");
  await fs.writeFile(path.join(project, lockName), lock);
  // Actual missing installed dependency forces repair despite matching configuration and intent.
  await fs.rm(path.join(project, "node_modules/managed-dep"), { recursive: true, force: true });
  assert.equal((await apply()).dependencyWork, "completed");
  assert.equal(await version(), "2.0.0");
  // Root lifecycle fails AFTER packages and lock exist. Config and saved intent must remain.
  await fs.writeFile(path.join(project, "fail-lifecycle"), "");
  await put(path.join(policy, "typescript/base/files/.oxlintrc.json"), { rules: { "no-debugger": "warn" } });
  const failed = await run(applyPlan(await plan(), { approved: true, dependencies: adapter }).pipe(Effect.match({
    onSuccess: () => { throw Error("Expected lifecycle failure"); }, onFailure: (error) => error })));
  assert.ok(failed instanceof ApplicationError);
  assert.equal(failed.phase, "dependencies");
  assert.match(failed.message, /42|postinstall/);
  assert.match(failed.message, /next assessment requires installation/);
  assert.equal(failed.report.status, "failed");
  assert.ok(await fs.readFile(path.join(project, ".its-checks.json"), "utf8"));
  assert.equal(JSON.parse(await fs.readFile(path.join(project, ".oxlintrc.json"), "utf8")).rules["no-debugger"], "warn");
  assert.equal(await run(adapter.assess(await plan())), "required");
  await fs.unlink(path.join(project, "fail-lifecycle"));
  assert.equal((await apply()).dependencyWork, "completed");
  const recoveredCount = count();
  assert.equal((await apply()).dependencyWork, "not-required");
  assert.equal(count(), recoveredCount);
  selected = empty;
  await put(path.join(policy, "typescript/base/bundle.json"), declaration(null));
  if (manager === "bun") {
    // A late removal failure persists the new manifest/intent before a fresh plan loses removal identity.
    const removedTarget = await fs.realpath(path.join(project, "node_modules/managed-dep"));
    const removedBytes = await fs.readFile(path.join(removedTarget, "package.json"));
    await fs.writeFile(path.join(project, "fail-lifecycle"), "");
    const removalFailure = await run(applyPlan(await plan(), { approved: true, dependencies: adapter }).pipe(Effect.match({
      onSuccess: () => { throw Error("Expected removal lifecycle failure"); }, onFailure: (error) => error })));
    assert.ok(removalFailure instanceof ApplicationError);
    assert.equal(removalFailure.phase, "dependencies");
    assert.match(removalFailure.message, /42|postinstall/);
    assert.match(removalFailure.message, /Unlinked approved removed dependencies node_modules\/managed-dep \(store targets preserved\)/);
    await assert.rejects(fs.lstat(path.join(project, "node_modules/managed-dep")), { code: "ENOENT" });
    assert.equal((JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"))).devDependencies["managed-dep"], undefined);
    const retry = await plan();
    assert.ok(!retry.packageEntries.some((entry) => entry.name === "managed-dep"), "fresh plan no longer identifies the removal");
    assert.equal(await run(adapter.assess(retry)), "required");
    await fs.unlink(path.join(project, "fail-lifecycle"));
    assert.equal((await run(applyPlan(retry, { approved: true, dependencies: adapter }))).dependencyWork, "completed");
    assert.equal((await apply()).dependencyWork, "not-required");
    await assert.rejects(fs.lstat(path.join(project, "node_modules/managed-dep")), { code: "ENOENT" });
    assert.deepEqual(await fs.readFile(path.join(removedTarget, "package.json")), removedBytes, "removed link target is preserved");
  } else assert.equal((await apply()).dependencyWork, "completed");
  await assert.rejects(fs.stat(path.join(project, "node_modules/managed-dep/package.json")), { code: "ENOENT" });
  assert.equal(await version("unrelated-dep"), "1.0.0");
  assert.equal((await apply()).dependencyWork, "not-required");
  // Root lifecycle command changes, including helper-only updates behind an
  // unchanged wrapper, still execute once with real native managers.
  const beforeLifecycle = count();
  let wrapper: string | undefined;
  for (const value of ["first", "second"]) {
    await put(path.join(policy, "typescript/base/bundle.json"), { ...declaration(null), scripts: {
      check: helper, prepare: `node -e 'require("node:fs").appendFileSync("prepare.log","${value}\\n")'`,
    } });
    assert.equal(await run(adapter.assess(await plan())), "required");
    assert.equal((await apply()).dependencyWork, "completed");
    const current = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8")).scripts.prepare;
    if (wrapper) assert.equal(current, wrapper);
    wrapper = current;
    assert.equal((await apply()).dependencyWork, "not-required");
  }
  assert.equal(count(), beforeLifecycle + 2);
  assert.equal(await fs.readFile(path.join(project, "prepare.log"), "utf8"), "first\nsecond\n");
  const final = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"));
  assert.deepEqual(final.custom, { preserved: true });
  assert.equal(final.scripts.postinstall, lifecycle);
  assert.equal(final.devDependencies["unrelated-dep"], "file:../keep.tgz");
  t.diagnostic(`${count()} real installs (includes ${manager === "bun" ? "two intentional lifecycle failures" : "one intentional lifecycle failure"}); local archives only; no-op runs execute no install`);
});

for (const manager of Object.keys(testedVersions) as PackageManager[]) for (const relationship of manager === "npm" ? ["dependencies", "peerDependencies"] : ["dependencies"]) {
  test(`${manager}: remove a direct requirement while retaining its incidental ${relationship} installation`, { timeout: 120_000 }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `its-checks-incidental-${manager}-`));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const project = path.join(root, "project"), policy = path.join(root, "policy");
    const put = async (file: string, value: string | object) => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
    };
    // Both packages are authored local archives with no executable code/hooks.
    // npm is offline so the peer case cannot silently fetch a registry package.
    for (const [archive, manifest] of [
      ["leaf", { name: "migration-leaf", version: "1.0.0" }],
      ["consumer", { name: "remaining-dep", version: "1.0.0", [relationship]: {
        "migration-leaf": relationship === "peerDependencies" ? "1.0.0" : `file:${path.join(root, "leaf.tgz")}`,
      } }],
    ] as const) {
      const directory = path.join(root, archive, "package");
      await put(path.join(directory, "package.json"), manifest);
      const tar = await run(nodeManagerOperations.run("tar", ["-czf", path.join(root, `${archive}.tgz`), "-C", path.dirname(directory), "package"], root));
      assert.equal(tar.code, 0, tar.stderr);
    }
    await put(path.join(project, "package.json"), { name: "incidental-project", private: true,
      packageManager: `${manager}@${testedVersions[manager]}`,
      devDependencies: { "remaining-dep": "file:../consumer.tgz", "migration-leaf": "file:../leaf.tgz" } });
    if (manager === "npm") await put(path.join(project, ".npmrc"), "offline=true\naudit=false\nfund=false\n");
    if (manager === "pnpm") await put(path.join(project, ".npmrc"), "manage-package-manager-versions=false\n");
    if (manager === "yarn") await put(path.join(project, ".yarnrc"), "disable-self-update-check true\n");
    if (manager === "bun") await put(path.join(project, "bunfig.toml"), '[install]\nlinker = "isolated"\n');
    await put(path.join(policy, "bundle.json"), { schemaVersion: 1, source: {
      repository: "https://github.com/example/fork", revision: "a".repeat(40), selectionSchema: "schemas/selections.schema.json" } });
    const declaration = path.join(policy, "typescript/base/bundle.json");
    await put(declaration, { name: "Base" });
    const resolution = await run(resolveTargetManager(project));
    if (resolution.kind !== "resolved") throw Error("Expected manager");
    let installs = 0;
    const adapter = createDependencyAdapter(resolution.target, { run: (command, args, cwd) => {
      if (args[0] === "install") installs++;
      return nodeManagerOperations.run(command, args, cwd);
    } });
    const plan = async () => {
      const previous = await run(loadPreviousIntent(project));
      const loaded = await run(loadPolicy(policy, empty));
      return run(planProject(project, await run(resolveInputs(loaded, {})), {
        scripts: resolution.target.scripts, ...(previous ? { previous } : {}), currentBundles: loaded.bundles }));
    };
    const apply = async () => run(applyPlan(await plan(), { approved: true, dependencies: adapter }));
    assert.equal((await apply()).dependencyWork, "completed");
    await put(declaration, { name: "Base", migration: { removeDevDependencies: ["migration-leaf"] } });
    const removal = await plan();
    assert.ok(removal.packageEntries.some((entry) => entry.name === "migration-leaf" && entry.kind === "removal" && entry.conflict));
    assert.equal(await run(adapter.assess(removal)), "required");
    assert.equal((await run(applyPlan(removal, { approved: true, dependencies: adapter }))).dependencyWork, "completed");
    const manifest = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"));
    assert.equal(manifest.devDependencies["migration-leaf"], undefined);
    assert.equal(manifest.devDependencies["remaining-dep"], "file:../consumer.tgz");
    const resolvedLeaf = await run(nodeManagerOperations.run("node", ["-e",
      'const f=require("node:fs");const p=require.resolve("migration-leaf/package.json",{paths:[f.realpathSync("node_modules/remaining-dep")]});console.log(JSON.parse(f.readFileSync(p)).version)',
    ], project));
    assert.equal(resolvedLeaf.code, 0, resolvedLeaf.stderr);
    assert.equal(resolvedLeaf.stdout.trim(), "1.0.0", "remaining package can still resolve its dependency");
    for (let rerun = 0; rerun < 2; rerun++) {
      const matching = await plan();
      assert.ok(matching.files.every((file) => file.kind === "noop"));
      assert.equal(await run(adapter.assess(matching)), "not-required");
      const report = await run(applyPlan(matching, { approved: true, dependencies: adapter }));
      assert.equal(report.dependencyWork, "not-required");
      assert.ok(report.completed.every((operation) => operation.kind === "assess-dependencies"));
    }
    assert.equal(installs, 2);
    // A native graph reference is required; an unrelated leftover root package
    // must not become acceptable just because another migration is incidental.
    await put(declaration, { name: "Base", migration: { removeDevDependencies: ["migration-leaf", "obsolete-orphan"] } });
    await put(path.join(project, "node_modules/obsolete-orphan/package.json"), { name: "obsolete-orphan", version: "1.0.0" });
    assert.equal(await run(adapter.assess(await plan())), "required");
    assert.equal(installs, 2, "assessment never reconciles native state itself");
  });
}
