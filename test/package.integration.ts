import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { defined, json, strings } from "./shared/assertions.ts";

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, "..");

/** Packaging checks content, not editable policy opinions. Behavioral checks replace
 * shipped policy with fixed test-owned files in each isolated CLI fixture. */
await test(
  "packed source CLI ships its runtime assets and runs without Bun with production dependencies only",
  { timeout: 120_000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-checks-package-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const archive = path.join(root, "its-checks.tgz");
    await exec("bun", ["pm", "pack", "--ignore-scripts", "--filename", archive, "--quiet"], {
      cwd: repo,
    });
    await exec("tar", ["-xzf", archive, "-C", root]);
    const packed = path.join(root, "package");
    const manifest = json(await fs.readFile(path.join(packed, "package.json"), "utf8"));
    const binEntries = strings(manifest.bin);
    const engines = strings(manifest.engines);
    const scripts = strings(manifest.scripts ?? {});
    assert.deepEqual(manifest.bin, { "its-checks": "bin/its-checks.js" });
    assert.match(
      await fs.readFile(path.join(packed, defined(binEntries["its-checks"])), "utf8"),
      /^#!\/usr\/bin\/env node\n/,
    );
    assert.equal(engines.bun, undefined);
    assert.equal(engines.node, ">=22");
    for (const hook of ["build", "prepare", "prepack", "preinstall", "install", "postinstall"]) {
      assert.equal(scripts[hook], undefined, `Git installation must not trigger ${hook}`);
    }
    const files = async (directory: string, prefix = ""): Promise<string[]> => {
      const result: string[] = [];
      for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
        const relative = path.join(prefix, entry.name);
        if (entry.isDirectory()) {
          result.push(...(await files(directory, relative)));
        } else {
          result.push(relative);
        }
      }
      return result.toSorted();
    };
    const expected: string[] = ["package.json", "README.md", "LICENSE"];
    for (const directory of ["bin", "src", "policy", "schemas"]) {
      for (const relative of await files(path.join(repo, directory))) {
        if (directory === "src" && /^modules\/[^/]+\/tests\//.test(relative)) {
          continue;
        }
        const file = path.join(directory, relative);
        expected.push(file);
        assert.deepEqual(
          await fs.readFile(path.join(packed, file)),
          await fs.readFile(path.join(repo, file)),
          `${file} must ship unchanged`,
        );
      }
    }
    assert.deepEqual(
      await fs.readFile(path.join(packed, "LICENSE")),
      await fs.readFile(path.join(repo, "LICENSE")),
    );
    const packedFiles = await files(packed);
    assert.equal(
      packedFiles.some((file) => /^src\/modules\/[^/]+\/tests\//.test(file)),
      false,
      "module tests and fixtures must not ship",
    );
    assert.deepEqual(
      packedFiles,
      expected.toSorted(),
      "only runtime source/assets and package metadata ship, including policy dotfiles",
    );

    const consumer = path.join(root, "consumer");
    await fs.mkdir(consumer);
    await fs.writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify({ private: true, dependencies: { "its-checks": "file:../its-checks.tgz" } }),
    );
    // No package lifecycle scripts may run during the fixture installation. The CLI
    // suite runs offline npm installs with no fixture dependencies or lifecycle scripts.
    // Only the consumer's prerequisites are available, including during installation.
    const bin = path.join(root, "bin");
    await fs.mkdir(bin);
    for (const command of ["node", "npm", "git", "python3", "sh"]) {
      const { stdout } = await exec("sh", ["-c", `command -v ${command}`]);
      await fs.symlink(stdout.trim(), path.join(bin, command));
    }
    const env = { ...process.env, PATH: bin };
    await assert.rejects(exec("bun", ["--version"], { env }), { code: "ENOENT" });
    await exec("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: consumer,
      env,
      timeout: 60_000,
    });
    for (const dev of ["typescript", "yarn"]) {
      await assert.rejects(fs.stat(path.join(consumer, "node_modules", dev)), { code: "ENOENT" });
    }
    const installed = await fs.realpath(path.join(consumer, "node_modules/its-checks"));
    assert.ok(
      installed.startsWith(consumer + path.sep),
      "installed CLI must not resolve into the checkout",
    );
    const result = await exec("python3", [path.join(repo, "test/cli.pty.py")], {
      cwd: consumer,
      env: { ...env, ITS_CHECKS_PACKAGE_ROOT: consumer },
      timeout: 60_000,
    });
    t.diagnostic(`${result.stdout.trim()}\n${result.stderr.trim()}`);

    // Exercise npx's Git consumption path using a local fork, without publishing.
    for (const args of [
      ["init", "--quiet"],
      ["add", "."],
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
    ]) {
      await exec("git", args, { cwd: packed, env });
    }
    const { stdout: commit } = await exec("git", ["rev-parse", "HEAD"], { cwd: packed, env });
    const gitConsumer = path.join(root, "git-consumer");
    await fs.mkdir(gitConsumer);
    await assert.rejects(
      exec(
        "npm",
        [
          "exec",
          "--yes",
          "--ignore-scripts",
          `--package=git+file://${packed}#${commit.trim()}`,
          "--",
          "its-checks",
        ],
        {
          cwd: gitConsumer,
          env: { ...env, npm_config_cache: path.join(root, "npm-cache") },
          timeout: 60_000,
        },
      ),
      { code: 1, stderr: /its-checks requires an interactive terminal/ },
    );
  },
);
