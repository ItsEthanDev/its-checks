import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { object, objects } from "../../../../test/shared/assertions.ts";
import { fixture, revision, snapshot } from "../../../../test/shared/fixtures.ts";
import { headless } from "../index.ts";
const run = Effect.runPromise;
await test("options reports an exact source revision, visibility, dependencies and inputs without reading the target", async (t) => {
  const f = await fixture(t);
  await f.add("extra", { name: "Extra", hidden: true });
  await fs.unlink(path.join(f.project, "package.json"));
  const before = await snapshot(f.project);
  const result = object(
    (await run(headless(["options", "Example/Fork", "--json"], f.project, f.root, f.store))).result,
  );
  assert.equal(result.repository, "example/fork");
  assert.equal(result.commit, revision.commit);
  assert.equal(objects(result.bundles)[1]?.hidden, true);
  assert.deepEqual(await snapshot(f.project), before);
});
await test("headless plans are read-only, reject stale targets/runtime, and ignore policy and test edits in executable identity", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, "bin"));
  await fs.mkdir(path.join(f.root, "schemas"));
  await fs.mkdir(path.join(f.root, "src/modules/example/tests"), { recursive: true });
  await fs.writeFile(path.join(f.root, "package.json"), "{}");
  const runtime = path.join(f.root, "src/modules/example/index.ts");
  await fs.writeFile(runtime, "// runtime");
  const testFile = path.join(f.root, "src/modules/example/tests/test.ts");
  await fs.writeFile(testFile, "// test");
  const config = path.join(f.root, "setup.json");
  await fs.writeFile(
    config,
    JSON.stringify({ schemaVersion: 2, sources: [f.config()], packageManager: "npm" }),
  );
  const before = await snapshot(f.project);
  const create = async (name: string) =>
    object(
      (
        await run(
          headless(
            ["plan", "--config", config, "--out", path.join(f.root, name)],
            f.project,
            f.root,
            f.store,
          ),
        )
      ).result,
    );
  const first = await create("first.plan");
  await fs.writeFile(testFile, "// test edit");
  await fs.writeFile(path.join(f.policy, "README.md"), "policy docs");
  assert.equal((await create("second.plan")).generator, first.generator);
  assert.deepEqual(await snapshot(f.project), before);
  await assert.rejects(create("first.plan"), /EEXIST/);
  await fs.writeFile(runtime, "// new runtime");
  await assert.rejects(
    run(headless(["apply", path.join(f.root, "first.plan")], f.project, f.root, f.store)),
    /Generator changed/,
  );
  await fs.writeFile(runtime, "// runtime");
  await fs.writeFile(path.join(f.project, "package.json"), '{"changed":true}');
  await assert.rejects(
    run(headless(["apply", path.join(f.root, "first.plan")], f.project, f.root, f.store)),
    /changed/i,
  );
});
await test("headless planning rejects missing answers, mutable commits, duplicate sources, and hidden explicit selections", async (t) => {
  const f = await fixture(t);
  await f.add("base", {
    inputs: [
      {
        id: "label",
        prompt: "Label",
        type: "string",
        default: "default",
        destination: { file: ".oxlintrc.json", field: ["label"] },
      },
    ],
  });
  await f.write("base/files/.oxlintrc.json", { label: "placeholder" });
  const config = path.join(f.root, "setup.json");
  const out = path.join(f.root, "plan.json");
  const before = await snapshot(f.project);
  for (const [sources, expression] of [
    [[f.config()], /Missing explicit/],
    [[{ ...f.config(), commit: "main" }], /exact policy commit/],
    [[f.config(), f.config()], /Duplicate/],
  ] as const) {
    await fs.writeFile(
      config,
      JSON.stringify({ schemaVersion: 2, sources, packageManager: "npm" }),
    );
    await assert.rejects(
      run(headless(["plan", "--config", config, "--out", out], f.project, f.root, f.store)),
      expression,
    );
  }
  await assert.rejects(run(headless(["invalid"], f.project, f.root, f.store)), /Usage/);
  await assert.rejects(fs.stat(out), { code: "ENOENT" });
  assert.deepEqual(await snapshot(f.project), before);
});
