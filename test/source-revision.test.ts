import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { Effect } from "effect";

import { executingCommit } from "../src/source-revision.ts";
import { snapshot } from "./fixtures.ts";

const exec = promisify(execFile);
const run = Effect.runPromise;
async function temporary(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-checks-revision-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const put = async (file: string, value: object | string) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
};

await test("generating commit belongs to a clean executing checkout, never an enclosing target repository", async (t) => {
  const root = await temporary(t);
  await put(path.join(root, "package.json"), { name: "its-checks" });
  const git = async (...args: string[]) => (await exec("git", args, { cwd: root })).stdout.trim();
  await git("init", "--quiet");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "generator",
  );
  const commit = await git("rev-parse", "HEAD");
  assert.equal(await run(executingCommit(root)), commit);
  await put(path.join(root, "package.json"), { name: "edited" });
  assert.equal(
    await run(executingCommit(root)),
    undefined,
    "tracked edits have no exact generating commit",
  );
  await git("restore", "package.json");
  await put(path.join(root, "untracked-policy.json"), {});
  assert.equal(
    await run(executingCommit(root)),
    undefined,
    "untracked policy edits are not described by HEAD",
  );
  await fs.unlink(path.join(root, "untracked-policy.json"));
  const nested = path.join(root, "copied-package");
  await put(path.join(nested, "package.json"), { name: "its-checks" });
  assert.equal(
    await run(executingCommit(nested)),
    undefined,
    "do not climb to the target/parent Git repository",
  );
});

const npmLock = (resolved: string) => ({
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { "its-checks": "github:example/fork#main" } },
    "node_modules/its-checks": { resolved },
    "node_modules/other": { resolved: `git+https://example.com/other.git#${"d".repeat(40)}` },
  },
});
const bunLock = (request: string, resolved = "c".repeat(7)) => ({
  lockfileVersion: 2,
  workspaces: { "": { dependencies: { "its-checks": request } } },
  packages: {
    "its-checks": [
      `its-checks@github:example/fork#${resolved}`,
      {},
      "example-fork-cache",
      "sha512-fixture",
    ],
  },
});

await test("npm provenance uses the installed package's resolved Git commit, not its requested branch or another package", async (t) => {
  const root = await temporary(t),
    installed = path.join(root, "node_modules/its-checks");
  await put(path.join(installed, "package.json"), { name: "its-checks" });
  await put(
    path.join(root, "package-lock.json"),
    npmLock(`git+ssh://git@github.com/example/fork.git#${"b".repeat(40)}`),
  );
  const before = await snapshot(root);
  assert.equal(await run(executingCommit(installed)), "b".repeat(40));
  assert.deepEqual(await snapshot(root), before, "provenance lookup is read-only");
  for (const ref of [
    "file:../its-checks.tgz",
    `https://registry.invalid/its-checks.tgz#${"b".repeat(40)}`,
    "git+https://github.com/example/fork.git#main",
  ]) {
    await put(path.join(root, "package-lock.json"), npmLock(ref));
    assert.equal(await run(executingCommit(installed)), undefined);
  }
  await put(path.join(root, "package-lock.json"), "{broken");
  assert.equal(
    await run(executingCommit(installed)),
    undefined,
    "optional provenance must not prevent setup",
  );
});

await test("Bunx abbreviated resolutions are omitted unless a full requested pin matches that resolution", async (t) => {
  const root = await temporary(t),
    installed = path.join(root, "node_modules/its-checks");
  await put(path.join(installed, "package.json"), { name: "its-checks" });
  const writeLock = (value: object) =>
    put(
      path.join(root, "bun.lock"),
      `// Native Bun JSONC includes trailing commas\n${JSON.stringify(value, null, 2).replace(
        /\n}$/,
        ",\n}",
      )}\n`,
    );
  await writeLock(bunLock("github:example/fork"));
  assert.equal(await run(executingCommit(installed)), undefined);
  for (const request of [
    `github:example/fork#${"c".repeat(40)}`,
    `git+https://github.com/example/fork.git#${"c".repeat(40)}`,
  ]) {
    await writeLock(bunLock(request));
    assert.equal(await run(executingCommit(installed)), "c".repeat(40));
  }
  for (const request of [
    `github:example/fork#${"d".repeat(40)}`,
    `github:example/other#${"c".repeat(40)}`,
  ]) {
    await writeLock(bunLock(request));
    assert.equal(await run(executingCommit(installed)), undefined);
  }
  await writeLock(bunLock("github:example/fork#main", "e".repeat(40)));
  assert.equal(await run(executingCommit(installed)), "e".repeat(40));
  await put(path.join(root, "package-lock.json"), {
    packages: {
      "node_modules/its-checks": { resolved: `git+https://example.com/fork.git#${"b".repeat(40)}` },
    },
  });
  assert.equal(
    await run(executingCommit(installed)),
    undefined,
    "ambiguous native lock evidence is not a generating revision",
  );
});
