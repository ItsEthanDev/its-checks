import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect, Schema } from "effect";

import { objects } from "../../../../test/shared/assertions.ts";
import { json } from "../../../../test/shared/assertions.ts";
import { defined } from "../../../../test/shared/assertions.ts";
import { snapshot } from "../../../../test/shared/fixtures.ts";
import { loadPreviousIntent, selectionFilename } from "../../policy/index.ts";
import { nodeApplicationFileSystem } from "../adapters.ts";
import { applyPlan, ApplicationError, OperationError } from "../index.ts";
import { noInstall, setup, failure } from "./application-fixtures.ts";
const run = Effect.runPromise;
await test("filesystem failure reports completed files, observed partial bytes/mode, stops and recovers by replanning", async (t) => {
  const f = await setup(t);
  const plan = await f.plan();
  let assessed = false;
  const error = await failure(
    applyPlan(plan, {
      approved: true,
      dependencies: {
        ...noInstall,
        assess: () => {
          assessed = true;
          return Effect.succeed("not-required");
        },
      },
      fileSystem: {
        ...nodeApplicationFileSystem,
        writeFile: (destination, state, create) =>
          destination.endsWith(".oxfmtrc.json")
            ? Effect.tryPromise({
                try: async () => {
                  await fs.writeFile(destination, "partial", { mode: 0o600 });
                  throw Error("disk full after partial write");
                },
                catch: (cause) => new OperationError({ detail: String(cause) }),
              })
            : nodeApplicationFileSystem.writeFile(destination, state, create),
      },
    }),
  );
  assert.ok(Schema.is(ApplicationError)(error));
  assert.equal(error.phase, "filesystem");
  assert.equal(assessed, false);
  assert.deepEqual(error.report.completed, []);
  assert.equal(error.report.failed?.path, ".oxfmtrc.json");
  assert.deepEqual(error.report.observed, {
    kind: "file",
    base64: Buffer.from("partial").toString("base64"),
    mode: 0o600,
  });
  assert.ok(error.report.incomplete.some((operation) => operation.path === "package.json"));
  assert.match(defined(error.report.retry), /fresh plan/);
  assert.equal(await run(loadPreviousIntent(f.project)), undefined);
  const retry = await f.plan();
  await run(applyPlan(retry, { approved: true, dependencies: noInstall }));
  assert.equal(await fs.readFile(path.join(f.project, ".oxfmtrc.json"), "utf8"), "{}\n");
});
await test("new symlink parents and leafs after planning fail without traversing outside the project", async (t) => {
  const f = await setup(t);
  await f.write("base/files/nested/config.sh", "managed");
  const plan = await f.plan();
  await fs.symlink(f.root, path.join(f.project, "nested"));
  const before = await snapshot(f.project);
  const error = await failure(applyPlan(plan, { approved: true, dependencies: noInstall }));
  assert.equal(error.phase, "validation");
  assert.deepEqual(error.report.completed, []);
  assert.deepEqual(await snapshot(f.project), before);
  await assert.rejects(fs.stat(path.join(f.root, "config.sh")), { code: "ENOENT" });
  await fs.unlink(path.join(f.project, "nested"));
  await fs.symlink(path.join(f.project, "package.json"), path.join(f.project, ".oxlintrc.json"));
  assert.equal(
    (await failure(applyPlan(plan, { approved: true, dependencies: noInstall }))).phase,
    "validation",
  );
});
await test("failed parent creation reports observed directory without deleting it or continuing", async (t) => {
  const f = await setup(t);
  await f.write("base/files/tools/deep/check.sh", "echo check");
  const error = await failure(
    applyPlan(await f.plan(), {
      approved: true,
      dependencies: noInstall,
      fileSystem: {
        ...nodeApplicationFileSystem,
        createDirectory: (destination) =>
          nodeApplicationFileSystem.createDirectory(destination).pipe(
            Effect.andThen(
              Effect.fail(
                new OperationError({
                  detail: "directory created but downstream filesystem failure",
                }),
              ),
            ),
          ),
      },
    }),
  );
  assert.deepEqual(error.report.failed, { kind: "create-directory", path: "tools" });
  assert.notEqual(error.report.observed, "unavailable");
  assert.equal(
    typeof error.report.observed === "object" && error.report.observed.kind,
    "directory",
  );
  assert.ok(
    error.report.incomplete.some(
      (entry) => entry.kind === "create-directory" && entry.path === "tools",
    ),
  );
  assert.ok(
    error.report.incomplete.some(
      (entry) => entry.kind === "write-file" && entry.path === "tools/deep/check.sh",
    ),
  );
  assert.equal((await fs.stat(path.join(f.project, "tools"))).isDirectory(), true);
  await assert.rejects(fs.stat(path.join(f.project, "tools/deep")), { code: "ENOENT" });
  await run(applyPlan(await f.plan(), { approved: true, dependencies: noInstall }));
});
await test("file removal failure stops and reports retained departing contribution", async (t) => {
  const f = await setup(t);
  await f.write("base/files/prettier.config.js", "throw Error('never execute');");
  const prior = await f.load();
  const declarationFile = path.join(f.policy, "base/bundle.json");
  const declaration = json(await fs.readFile(declarationFile, "utf8"));
  const files = objects(declaration.files).filter((file) => file.target !== "prettier.config.js");
  await fs.writeFile(declarationFile, JSON.stringify({ ...declaration, files }));
  await f.put("prettier.config.js", "throw Error('never execute');");
  const error = await failure(
    applyPlan(await f.plan(undefined, { previousBundles: prior.bundles }), {
      approved: true,
      dependencies: noInstall,
      fileSystem: {
        ...nodeApplicationFileSystem,
        removeFile: () => Effect.fail(new OperationError({ detail: "Removal denied" })),
      },
    }),
  );
  assert.deepEqual(error.report.failed, { kind: "remove-file", path: "prettier.config.js" });
  assert.notEqual(error.report.observed, "unavailable");
  assert.equal(typeof error.report.observed === "object" && error.report.observed.kind, "file");
  assert.deepEqual(error.report.incomplete, [
    { kind: "remove-file", path: "prettier.config.js" },
    { kind: "assess-dependencies", path: "package.json" },
    { kind: "install-dependencies", path: "package.json" },
    { kind: "write-file", path: selectionFilename },
  ]);
  assert.equal(
    await fs.readFile(path.join(f.project, "prettier.config.js"), "utf8"),
    "throw Error('never execute');",
  );
});
await test("a symlink introduced during application is rechecked before the next file write", async (t) => {
  const f = await setup(t);
  const outside = path.join(f.root, "outside.json");
  await fs.writeFile(outside, "keep");
  const error = await failure(
    applyPlan(await f.plan(), {
      approved: true,
      dependencies: noInstall,
      fileSystem: {
        ...nodeApplicationFileSystem,
        writeFile: (destination, state, create) =>
          nodeApplicationFileSystem.writeFile(destination, state, create).pipe(
            Effect.andThen(
              destination.endsWith(".oxfmtrc.json")
                ? Effect.tryPromise({
                    try: () => fs.symlink(outside, path.join(f.project, ".oxlintrc.json")),
                    catch: (cause) => new OperationError({ detail: String(cause) }),
                  })
                : Effect.void,
            ),
          ),
      },
    }),
  );
  assert.equal(error.phase, "filesystem");
  assert.deepEqual(error.report.completed, [{ kind: "write-file", path: ".oxfmtrc.json" }]);
  assert.equal(error.report.failed?.path, ".oxlintrc.json");
  assert.equal(error.report.observed, "unavailable");
  assert.equal(await fs.readFile(outside, "utf8"), "keep");
});
await test("a failed operation that already wrote intended bytes is not relabeled successful", async (t) => {
  const f = await setup(t);
  const plan = await f.plan();
  const error = await failure(
    applyPlan(plan, {
      approved: true,
      dependencies: noInstall,
      fileSystem: {
        ...nodeApplicationFileSystem,
        writeFile: (destination, state, create) =>
          nodeApplicationFileSystem
            .writeFile(destination, state, create)
            .pipe(
              Effect.andThen(
                Effect.fail(new OperationError({ detail: "failure after file was written" })),
              ),
            ),
      },
    }),
  );
  assert.deepEqual(error.report.completed, []);
  assert.equal(error.report.failed?.path, ".oxfmtrc.json");
  assert.deepEqual(
    error.report.observed,
    defined(plan.files.find((file) => file.path === ".oxfmtrc.json")).after,
  );
  assert.ok(error.report.incomplete.some((entry) => entry.path === ".oxfmtrc.json"));
});
