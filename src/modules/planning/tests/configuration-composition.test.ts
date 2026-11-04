import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { json } from "../../../../test/shared/assertions.ts";
import { defined, objects, object } from "../../../../test/shared/assertions.ts";
import { fixture } from "../../../../test/shared/fixtures.ts";
import { resolveInputs, loadPolicy } from "../../policy/index.ts";
import { planProject } from "../index.ts";
const run = Effect.runPromise;
async function setup(t: Parameters<typeof fixture>[0], a: object, b: object, arrays?: object) {
  const f = await fixture(t);
  for (const [id, value] of [
    ["one", a],
    ["two", b],
  ] as const) {
    await f.add(id, {
      name: id,
      requires: [],
      files: [
        {
          source: "files/config.json",
          target: "config.json",
          operation: "compose",
          format: "json",
          ...(arrays === undefined ? {} : { arrays }),
        },
      ],
    });
    await fs.mkdir(path.join(f.policy, id, "files"));
    await fs.writeFile(path.join(f.policy, id, "files/config.json"), JSON.stringify(value));
  }
  const plan = async () =>
    await run(
      planProject(f.project, await run(resolveInputs(await f.load(["two", "one"]), {})), {
        manager: "npm",
      }),
    );
  return { ...f, plan };
}
await test("objects compose recursively and identical values coalesce", async (t) => {
  const f = await setup(
    t,
    { rules: { a: "error", shared: true } },
    { rules: { b: "error", shared: true } },
  );
  const file = (await f.plan()).files.find((candidate) => candidate.path === "config.json")?.after;
  assert.ok(file?.kind === "file");
  assert.deepEqual(json(Buffer.from(file.base64, "base64").toString()), {
    rules: { a: "error", b: "error", shared: true },
  });
});
for (const [a, b] of [
  [{ value: 1 }, { value: 2 }],
  [{ values: [1] }, { values: [2] }],
  [{ value: {} }, { value: [] }],
]) {
  await test("incompatible scalar, array, or structural values fail", async (t) => {
    const f = await setup(t, defined(a), defined(b));
    await assert.rejects(f.plan(), /Incompatible/);
  });
}
await test("only explicitly declared arrays append with exact duplicate removal", async (t) => {
  const f = await setup(
    t,
    { ignores: ["dist", "coverage"] },
    { ignores: ["coverage", "generated"] },
    { "/ignores": "append-unique" },
  );
  const file = (await f.plan()).files.find((candidate) => candidate.path === "config.json")?.after;
  assert.ok(file?.kind === "file");
  assert.deepEqual(json(Buffer.from(file.base64, "base64").toString()), {
    ignores: ["dist", "coverage", "generated"],
  });
});
await test("incompatible composition declarations fail", async (t) => {
  const f = await setup(
    t,
    { ignores: ["one"] },
    { ignores: ["two"] },
    { "/ignores": "append-unique" },
  );
  const file = path.join(f.policy, "two/bundle.json");
  const declaration = json(await fs.readFile(file, "utf8"));
  const entry = { ...defined(objects(declaration.files)[0]) };
  delete entry.arrays;
  const files = [entry];
  await fs.writeFile(file, JSON.stringify({ ...declaration, files }));
  await assert.rejects(f.plan(), /composition declarations/);
});
await test("unrelated object fragments need not repeat another bundle's array declarations", async (t) => {
  const f = await setup(
    t,
    { ignores: ["dist"] },
    { rules: { check: true } },
    { "/ignores": "append-unique" },
  );
  await f.add("two", {
    name: "Two",
    requires: [],
    files: [
      { source: "files/config.json", target: "config.json", operation: "compose", format: "jsonc" },
    ],
  });
  await f.plan();
});
await test("explicit source-local field replacement restores the original on deselection", async (t) => {
  const f = await setup(
    t,
    { rules: { "example/rule": "error", keep: true } },
    { rules: { "example/rule": "off" } },
  );
  const files = [
    {
      source: "files/config.json",
      target: "config.json",
      operation: "compose",
      format: "json",
      replaces: { "/rules/example~1rule": "one" },
    },
  ];
  await f.add("two", { name: "Two", requires: ["one"], files });
  const current = await f.load(["two"]);
  const resolved = await run(resolveInputs(current, {}));
  const initial = await run(planProject(f.project, resolved, { manager: "npm" }));
  const after = initial.files.find((entry) => entry.path === "config.json")?.after;
  assert.ok(after?.kind === "file");
  assert.deepEqual(json(Buffer.from(after.base64, "base64").toString()), {
    rules: { "example/rule": "off", keep: true },
  });
  await fs.writeFile(path.join(f.project, "config.json"), Buffer.from(after.base64, "base64"));
  const restored = await run(
    planProject(f.project, await run(resolveInputs(await f.load(["one"]), {})), {
      manager: "npm",
      previousBundles: current.bundles,
    }),
  );
  const original = restored.files.find((entry) => entry.path === "config.json")?.after;
  assert.ok(original?.kind === "file");
  assert.equal(
    object(json(Buffer.from(original.base64, "base64").toString()).rules)["example/rule"],
    "error",
  );
  const external = await run(
    loadPolicy(f.policy, ["one"], { repository: "other/policy", commit: "a".repeat(40) }),
  );
  await assert.rejects(
    run(
      planProject(
        f.project,
        await run(
          resolveInputs(
            {
              ...current,
              sources: [...current.sources, ...external.sources],
              bundles: [...current.bundles, ...external.bundles],
            },
            {},
          ),
        ),
        { manager: "npm" },
      ),
    ),
    /Incompatible contributions/,
  );
  await f.add("two", {
    name: "Two",
    requires: ["one"],
    files: [{ ...defined(files[0]), replaces: { "/rules/example~1rule": "missing" } }],
  });
  await assert.rejects(f.plan(), /selected ordinary contribution/);
});
