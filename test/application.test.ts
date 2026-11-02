import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import {
  applyPlan,
  OperationError,
  createNodeApplicationFileSystem,
  nodeApplicationFileSystem,
  type ApplicationDependencies,
} from "../src/application.ts";
import { loadPolicy, type PolicySelections } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject, type ChangePlan } from "../src/planning.ts";
import { loadPreviousIntent, selectionFilename } from "../src/selections.ts";
import { noInstall, setup, failure, mtimes } from "./application-fixtures.ts";
import { defined, json, manifest as parseManifest, object } from "./assertions.ts";
import { snapshot } from "./fixtures.ts";

const run = Effect.runPromise;
const forbiddenMutation = () => Effect.die("Matching application must not mutate filesystem");
const empty: PolicySelections = { integrations: [], automation: [] };

await test("declined and unapproved plans perform zero writes and no external operations", async (t) => {
  const f = await setup(t);
  await f.put(".oxlintrc.json", "local edits");
  const plan = await f.plan();
  assert.equal(plan.requiresConfirmation, true);
  const before = await snapshot(f.project);
  const times = await mtimes(f.project);
  const forbidden: ApplicationDependencies = {
    assess: () => Effect.die("Must not assess"),
    install: () => Effect.die("Must not install"),
  };
  for (const approved of [false, undefined]) {
    const report = await run(
      applyPlan(plan, { ...(approved === undefined ? {} : { approved }), dependencies: forbidden }),
    );
    assert.equal(report.status, "declined");
    assert.deepEqual(report.completed, []);
  }
  assert.deepEqual(await snapshot(f.project), before);
  assert.deepEqual(await mtimes(f.project), times);
});

await test("incomplete and stale plans fail before writes, including stale modes and absent candidates", async (t) => {
  const f = await setup(t);
  const plan = await f.plan();
  const before = await snapshot(f.project);
  const incomplete = await failure(
    applyPlan({ ...plan, complete: false }, { approved: true, dependencies: noInstall }),
  );
  assert.equal(incomplete.phase, "validation");
  assert.deepEqual(incomplete.report.completed, []);
  assert.deepEqual(await snapshot(f.project), before);
  await fs.chmod(path.join(f.project, "package.json"), 0o600);
  assert.match(
    (await failure(applyPlan(plan, { approved: true, dependencies: noInstall }))).message,
    /Target changed/,
  );
  const fresh = await f.plan();
  await f.put("oxlint.config.ts", "throw Error('never import');");
  const changed = await snapshot(f.project);
  assert.match(
    (await failure(applyPlan(fresh, { approved: true, dependencies: noInstall }))).message,
    /Target changed/,
  );
  assert.deepEqual(await snapshot(f.project), changed);
});

await test("applies approved replacements/migration exactly, preserves unrelated manifest and file content", async (t) => {
  const f = await setup(t);
  await f.put("package.json", {
    name: "app",
    private: true,
    custom: { keep: [1, 2] },
    scripts: { install: "exit 99", check: "echo original" },
    devDependencies: { prettier: "3", unrelated: "4" },
  });
  await f.put(".oxlintrc.json", '{"rules":{"local":"error"}}');
  await fs.chmod(path.join(f.project, ".oxlintrc.json"), 0o600);
  await f.put("prettier.config.js", "throw Error('must not execute');");
  await f.put("unlisted.config.js", "keep");
  await f.write("typescript/base/files/tools/nested/check.sh", "#!/bin/sh\nexit 0\n");
  await fs.chmod(path.join(f.policy, "typescript/base/files/tools/nested/check.sh"), 0o755);
  const plan = await f.plan();
  // Policy edits after confirmation cannot change application output.
  await f.write("typescript/base/files/.oxlintrc.json", { rules: { different: "warn" } });
  const report = await run(applyPlan(plan, { approved: true, dependencies: noInstall }));
  assert.equal(report.status, "completed");
  assert.deepEqual(report.incomplete, []);
  for (const file of plan.files) {
    if (file.after.kind === "absent") {
      await assert.rejects(fs.lstat(path.join(f.project, file.path)), { code: "ENOENT" });
    } else {
      assert.equal(
        (await fs.readFile(path.join(f.project, file.path))).toString("base64"),
        file.after.base64,
      );
      assert.equal((await fs.stat(path.join(f.project, file.path))).mode & 0o777, file.after.mode);
    }
  }
  const manifest = parseManifest(await fs.readFile(path.join(f.project, "package.json"), "utf8"));
  assert.deepEqual(manifest.custom, { keep: [1, 2] });
  assert.equal(manifest.scripts.install, "exit 99");
  assert.equal(manifest.devDependencies.unrelated, "4");
  assert.equal(manifest.devDependencies.prettier, undefined);
  assert.equal(await fs.readFile(path.join(f.project, "unlisted.config.js"), "utf8"), "keep");
  assert.equal((await fs.stat(path.join(f.project, "tools/nested/check.sh"))).mode & 0o777, 0o755);
});

await test("matching rerun has zero filesystem mutations and unchanged mtimes", async (t) => {
  const f = await setup(t);
  await run(applyPlan(await f.plan(), { approved: true, dependencies: noInstall }));
  const plan = await f.plan();
  assert.ok(plan.files.every((file) => file.kind === "noop"));
  const before = await snapshot(f.project);
  const times = await mtimes(f.project);
  const report = await run(
    applyPlan(plan, {
      approved: true,
      dependencies: noInstall,
      fileSystem: {
        createDirectory: forbiddenMutation,
        writeFile: forbiddenMutation,
        removeFile: forbiddenMutation,
      },
    }),
  );
  assert.equal(report.dependencyWork, "not-required");
  assert.deepEqual(report.completed, [{ kind: "assess-dependencies", path: "package.json" }]);
  assert.deepEqual(await snapshot(f.project), before);
  assert.deepEqual(await mtimes(f.project), times);
});

await test("deselection removes identifiable contributions, retains unrelated directories and shared requirements", async (t) => {
  const f = await setup(t);
  await f.add("integrations/extra", {
    name: "Extra",
    scripts: { check: "echo extra" },
    devDependencies: { extra: "1", oxlint: "1.0.0" },
  });
  await f.write("typescript/integrations/extra/files/extra/config.sh", "managed");
  const selected = { integrations: ["extra"], automation: [] };
  const loaded = await run(loadPolicy(f.policy, selected));
  await run(applyPlan(await f.plan(selected), { approved: true, dependencies: noInstall }));
  await f.put("extra/unrelated.txt", "keep");
  const previous = await run(loadPreviousIntent(f.project));
  assert.ok(previous !== undefined);
  const plan = await f.plan(empty, { previous, currentBundles: loaded.bundles });
  assert.equal(plan.requiresConfirmation, true);
  await run(applyPlan(plan, { approved: true, dependencies: noInstall }));
  await assert.rejects(fs.stat(path.join(f.project, "extra/config.sh")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(f.project, "extra/unrelated.txt"), "utf8"), "keep");
  const manifest = parseManifest(await fs.readFile(path.join(f.project, "package.json"), "utf8"));
  assert.equal(manifest.devDependencies.extra, undefined);
  assert.equal(manifest.devDependencies.oxlint, "1.0.0");
  assert.doesNotMatch(defined(manifest.scripts["its-checks:check"]), /extra/);
});

await test("failed deselection retains retry identity until all cleanup finishes", async (t) => {
  const f = await setup(t);
  await f.add("integrations/extra", {
    name: "Extra",
    scripts: { check: "echo extra", extra: "echo exclusive" },
    devDependencies: { extra: "1", oxlint: "1.0.0" },
  });
  await f.write("typescript/integrations/extra/files/extra/config.sh", "managed");
  await f.put("package.json", {
    scripts: { extra: "echo original", unrelated: "echo keep" },
    devDependencies: { unrelated: "2" },
  });
  const selected = { integrations: ["extra"], automation: [] };
  await run(applyPlan(await f.plan(selected), { approved: true, dependencies: noInstall }));
  await f.put("extra/unrelated.txt", "keep");
  await f.write("typescript/base/files/.oxfmtrc.json", { printWidth: 100 });
  const replan = async () => {
    const previous = await run(loadPreviousIntent(f.project));
    assert.ok(previous !== undefined);
    const currentBundles = (await run(loadPolicy(f.policy, previous))).bundles;
    return await f.plan(empty, { previous, currentBundles });
  };
  const approved = await replan();
  const displayed = structuredClone(approved.files);
  const error = await failure(
    applyPlan(approved, {
      approved: true,
      dependencies: noInstall,
      fileSystem: {
        ...nodeApplicationFileSystem,
        removeFile: () => Effect.fail(new OperationError({ detail: "Cleanup denied" })),
      },
    }),
  );
  assert.equal(error.report.failed?.path, "extra/config.sh");
  assert.ok(error.report.completed.some((entry) => entry.path === ".oxfmtrc.json"));
  assert.equal(
    error.report.completed.some((entry) => entry.path === selectionFilename),
    false,
  );
  assert.deepEqual(approved.files, displayed);
  assert.deepEqual((await run(loadPreviousIntent(f.project)))?.integrations, ["extra"]);
  assert.equal(
    json(await fs.readFile(path.join(f.project, ".oxfmtrc.json"), "utf8")).printWidth,
    100,
  );
  await run(applyPlan(await replan(), { approved: true, dependencies: noInstall }));
  await assert.rejects(fs.stat(path.join(f.project, "extra/config.sh")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(f.project, "extra/unrelated.txt"), "utf8"), "keep");
  const manifest = parseManifest(await fs.readFile(path.join(f.project, "package.json"), "utf8"));
  assert.equal(manifest.devDependencies.extra, undefined);
  assert.equal(manifest.devDependencies.oxlint, "1.0.0");
  assert.equal(manifest.devDependencies.unrelated, "2");
  assert.equal(manifest.scripts.extra, "echo original");
  assert.equal(manifest.scripts["its-checks:extra"], undefined);
  assert.equal(manifest.scripts.unrelated, "echo keep");
  assert.doesNotMatch(defined(manifest.scripts["its-checks:check"]), /extra/);
  assert.deepEqual((await run(loadPreviousIntent(f.project)))?.integrations, []);
});

for (const failureAt of ["write", "publication"] as const) {
  await test(`failed selection ${failureAt} preserves retry identity and leaves no temporary files`, async (t) => {
    const f = await setup(t);
    await f.add("integrations/extra", { name: "Extra" });
    const selected = { integrations: ["extra"], automation: [] };
    await run(applyPlan(await f.plan(selected), { approved: true, dependencies: noInstall }));
    const previous = await run(loadPreviousIntent(f.project));
    assert.ok(previous !== undefined);
    const plan = await f.plan(empty, {
      previous,
      currentBundles: (await run(loadPolicy(f.policy, selected))).bundles,
    });
    assert.deepEqual(
      plan.files.filter((file) => file.kind !== "noop").map((file) => file.path),
      [selectionFilename],
    );
    const before = await snapshot(f.project);
    const fileSystem = createNodeApplicationFileSystem({
      ...fs,
      open: async (...args) => {
        const handle = await fs.open(...args);
        if (failureAt === "write") {
          const write = handle.writeFile.bind(handle);
          handle.writeFile = async () => {
            await write("partial JSON");
            throw Error("disk full during selection write");
          };
        }
        return handle;
      },
      rename:
        failureAt === "publication"
          ? () => {
              throw Error("selection publication failed");
            }
          : fs.rename,
    });
    const error = await failure(
      applyPlan(plan, { approved: true, dependencies: noInstall, fileSystem }),
    );
    assert.equal(error.phase, "filesystem");
    assert.equal(error.report.failed?.path, selectionFilename);
    assert.deepEqual(error.report.completed, []);
    assert.deepEqual(
      error.report.observed,
      defined(plan.files.find((file) => file.path === selectionFilename)).before,
    );
    assert.deepEqual(await snapshot(f.project), before); // No leftover staging file.
    const saved = await run(loadPreviousIntent(f.project));
    assert.deepEqual(saved?.integrations, ["extra"]);
    await run(
      applyPlan(
        await f.plan(empty, {
          previous: saved,
          currentBundles: (await run(loadPolicy(f.policy, saved))).bundles,
        }),
        { approved: true, dependencies: noInstall },
      ),
    );
    assert.deepEqual((await run(loadPreviousIntent(f.project)))?.integrations, []);
  });
}

await test("installation failure retains all configuration and intent; matching rerun still requests recovery", async (t) => {
  const f = await setup(t);
  let installed = false;
  let attempts = 0;
  const dependencies: ApplicationDependencies = {
    assess: () => Effect.succeed(installed ? "not-required" : "required"),
    install: (plan: ChangePlan) =>
      Effect.tryPromise({
        try: async () => {
          assert.ok((await run(loadPreviousIntent(f.project))) !== undefined);
          for (const file of plan.files) {
            if (file.after.kind === "file") {
              assert.equal(
                (await fs.readFile(path.join(f.project, file.path))).toString("base64"),
                file.after.base64,
              );
            }
          }
          attempts++;
          if (attempts === 1) {
            throw Error("install failed, lockfile may be partial");
          }
          installed = true;
        },
        catch: (cause) => new OperationError({ detail: String(cause) }),
      }),
  };
  const error = await failure(applyPlan(await f.plan(), { approved: true, dependencies }));
  assert.equal(error.phase, "dependencies");
  assert.equal(error.report.dependencyWork, "required");
  assert.deepEqual(error.report.incomplete, [
    { kind: "install-dependencies", path: "package.json" },
  ]);
  const retry = await f.plan();
  assert.ok(retry.files.every((file) => file.kind === "noop"));
  const times = await mtimes(f.project);
  const report = await run(applyPlan(retry, { approved: true, dependencies }));
  assert.equal(report.dependencyWork, "completed");
  assert.equal(attempts, 2);
  assert.deepEqual(await mtimes(f.project), times);
  await run(applyPlan(await f.plan(), { approved: true, dependencies }));
  assert.equal(attempts, 2);
});

await test("saved answers and config finish before dependency assessment fails", async (t) => {
  const f = await setup(t);
  await f.add("base", {
    name: "Base",
    inputs: [
      {
        id: "stylesheet",
        prompt: "Stylesheet",
        type: "path",
        destination: { file: ".oxfmtrc.json", field: ["sortTailwindcss", "stylesheet"] },
      },
    ],
  });
  await f.write("typescript/base/files/.oxfmtrc.json", {
    sortTailwindcss: { stylesheet: "authored.css" },
  });
  const policy = await run(loadPolicy(f.policy, empty));
  const resolved = await run(resolveInputs(policy, { base: { stylesheet: "src/app.css" } }));
  const plan = await run(planProject(f.project, resolved));
  const error = await failure(
    applyPlan(plan, {
      approved: true,
      dependencies: {
        ...noInstall,
        assess: () =>
          Effect.tryPromise({
            try: async () => {
              const intent = await run(loadPreviousIntent(f.project));
              assert.deepEqual(intent?.answers, { base: { stylesheet: "src/app.css" } });
              assert.equal(
                object(
                  json(await fs.readFile(path.join(f.project, ".oxfmtrc.json"), "utf8"))
                    .sortTailwindcss,
                ).stylesheet,
                "src/app.css",
              );
              throw Error("Cannot inspect installed state");
            },
            catch: (cause) => new OperationError({ detail: String(cause) }),
          }),
      },
    }),
  );
  assert.equal(error.phase, "dependencies");
  assert.equal(error.report.dependencyWork, "not-assessed");
  assert.deepEqual(error.report.failed, { kind: "assess-dependencies", path: "package.json" });
  assert.deepEqual(
    error.report.incomplete.map((entry) => entry.kind),
    ["assess-dependencies", "install-dependencies"],
  );
});
