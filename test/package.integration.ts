import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "..");

/** Packaging checks content, not editable policy opinions. Behavioral checks replace
 * shipped policy with fixed test-owned files in each isolated CLI fixture. */
test("packed source CLI ships its runtime assets and works with production dependencies only", { timeout: 120_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-checks-package-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const archive = path.join(root, "its-checks.tgz");
  await exec("bun", ["pm", "pack", "--ignore-scripts", "--filename", archive, "--quiet"], { cwd: repo });
  await exec("tar", ["-xzf", archive, "-C", root]);
  const packed = path.join(root, "package");
  const manifest = JSON.parse(await fs.readFile(path.join(packed, "package.json"), "utf8"));
  assert.deepEqual(manifest.bin, { "its-checks": "src/cli.ts" });
  assert.match(await fs.readFile(path.join(packed, manifest.bin["its-checks"]), "utf8"), /^#!\/usr\/bin\/env bun\n/);
  for (const hook of ["build", "prepare", "prepack", "preinstall", "install", "postinstall"]) {
    assert.equal(manifest.scripts?.[hook], undefined, `Git installation must not trigger ${hook}`);
  }
  const files = async (directory: string, prefix = ""): Promise<string[]> => {
    const result: string[] = [];
    for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) result.push(...await files(directory, relative));
      else result.push(relative);
    }
    return result.sort();
  };
  const expected: string[] = ["package.json", "README.md"];
  for (const directory of ["src", "policy", "schemas"]) for (const relative of await files(path.join(repo, directory))) {
    const file = path.join(directory, relative);
    expected.push(file);
    assert.deepEqual(await fs.readFile(path.join(packed, file)), await fs.readFile(path.join(repo, file)), `${file} must ship unchanged`);
  }
  assert.deepEqual(await files(packed), expected.sort(), "only runtime source/assets and package metadata ship, including policy dotfiles");

  const consumer = path.join(root, "consumer");
  await fs.mkdir(consumer);
  await fs.writeFile(path.join(consumer, "package.json"), JSON.stringify({ private: true, dependencies: { "its-checks": "file:../its-checks.tgz" } }));
  // No package lifecycle scripts may run during the fixture installation. The CLI
  // suite runs offline npm installs with no fixture dependencies or lifecycle scripts.
  await exec("bun", ["install", "--production", "--ignore-scripts"], { cwd: consumer, timeout: 60_000 });
  for (const dev of ["typescript", "yarn"]) {
    await assert.rejects(fs.stat(path.join(consumer, "node_modules", dev)), { code: "ENOENT" });
  }
  const installed = await fs.realpath(path.join(consumer, "node_modules/its-checks"));
  assert.ok(installed.startsWith(consumer + path.sep), "installed CLI must not resolve into the checkout");
  const result = await exec("python3", [path.join(repo, "test/cli.pty.py")], {
    cwd: consumer, env: { ...process.env, ITS_CHECKS_PACKAGE_ROOT: consumer }, timeout: 60_000,
  });
  t.diagnostic(result.stdout.trim() + "\n" + result.stderr.trim());
});
