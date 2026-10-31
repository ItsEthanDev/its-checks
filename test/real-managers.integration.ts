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
// Archives have NO scripts, network references, bin entries or dependencies. Never use shared fixture install: exit 99.
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
  const final = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"));
  assert.deepEqual(final.custom, { preserved: true });
  assert.equal(final.scripts.postinstall, lifecycle);
  assert.equal(final.devDependencies["unrelated-dep"], "file:../keep.tgz");
  t.diagnostic(`${count()} real installs (includes ${manager === "bun" ? "two intentional lifecycle failures" : "one intentional lifecycle failure"}); local archives only; no-op runs execute no install`);
});
