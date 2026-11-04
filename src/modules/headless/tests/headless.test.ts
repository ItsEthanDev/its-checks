import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { object } from "../../../../test/shared/assertions.ts";
import { fixture, snapshot } from "../../../../test/shared/fixtures.ts";
import { headless } from "../index.ts";

const run = Effect.runPromise;

await test("options discovers authored inputs without reading a target manifest", async (t) => {
  const f = await fixture(t);
  await f.add("integrations/example", { name: "Example", description: "An optional policy" });
  await fs.unlink(path.join(f.project, "package.json"));
  const before = await snapshot(f.project);
  const output = await run(headless(["options", "--json"], f.project, f.root));
  assert.equal(output.json, true);
  assert.equal(object(object(output.result).base).name, "TypeScript");
  assert.deepEqual(object(output.result).integrations, [
    {
      id: "example",
      key: "integrations/example",
      name: "Example",
      description: "An optional policy",
      inputs: [],
    },
  ]);
  assert.deepEqual(await snapshot(f.project), before);
});

await test("saved plans identify runtime source but ignore colocated tests, including their absence in packages", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, "bin"));
  await fs.mkdir(path.join(f.root, "src/modules/example/tests"), { recursive: true });
  await fs.writeFile(path.join(f.root, "package.json"), '{"type":"module"}');
  await fs.writeFile(path.join(f.root, "bin/entry.js"), "// runtime launcher\n");
  const runtime = path.join(f.root, "src/modules/example/index.ts");
  const tests = path.join(f.root, "src/modules/example/tests");
  await fs.writeFile(runtime, "// runtime source\n");
  await fs.writeFile(path.join(tests, "example.test.ts"), "// development test\n");
  const config = path.join(f.root, "setup.json");
  await fs.writeFile(
    config,
    JSON.stringify({
      integrations: [],
      automation: [],
      answers: {},
      packageManager: "npm",
    }),
  );
  const before = await snapshot(f.project);
  const plan = async (name: string) => {
    const out = path.join(f.root, `${name}.plan.json`);
    const output = await run(
      headless(["plan", "--config", config, "--out", out, "--json"], f.project, f.root),
    );
    return object(output.result);
  };
  const initial = await plan("initial");
  const planned = object(initial.plan);
  assert.equal(planned.complete, true);
  assert.deepEqual(planned.deferred, []);
  await fs.writeFile(path.join(tests, "example.test.ts"), "// changed test\n");
  assert.equal((await plan("test-edit")).generator, initial.generator);
  await fs.rm(tests, { recursive: true });
  assert.equal((await plan("packaged")).generator, initial.generator);
  await fs.writeFile(runtime, "// changed runtime\n");
  assert.notEqual((await plan("source-edit")).generator, initial.generator);
  assert.deepEqual(await snapshot(f.project), before);
});

await test("invalid commands and missing explicit answers fail without changing the target", async (t) => {
  const f = await fixture(t);
  await f.add("base", {
    name: "Base",
    inputs: [
      {
        id: "label",
        prompt: "Label",
        type: "string",
        destination: { file: ".oxlintrc.json", field: ["label"] },
      },
    ],
  });
  const config = path.join(f.root, "setup.json");
  await fs.writeFile(
    config,
    JSON.stringify({ integrations: [], automation: [], answers: {}, packageManager: "npm" }),
  );
  await f.write("typescript/base/files/.oxlintrc.json", { label: "placeholder" });
  const out = path.join(f.root, "invalid.plan.json");
  const before = await snapshot(f.project);
  await assert.rejects(run(headless(["invalid"], f.project, f.root)), /Usage:/);
  await assert.rejects(
    run(headless(["plan", "--config", config, "--out", out], f.project, f.root)),
    /Missing explicit answer/,
  );
  await assert.rejects(fs.stat(out), { code: "ENOENT" });
  assert.deepEqual(await snapshot(f.project), before);
});
