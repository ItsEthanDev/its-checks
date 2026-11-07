import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { json } from "../../../../test/shared/assertions.ts";
import { fixture } from "../../../../test/shared/fixtures.ts";
import { resolveInputs, type LoadedBundle } from "../../policy/index.ts";
import { planProject } from "../index.ts";

const run = Effect.runPromise;
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function contribute(f: Fixture, id: string, value: object, options: object = {}) {
  await f.add(id, { name: id, requires: [] });
  await f.write(`${id}/files/config.json`, value);
  await f.add(id, {
    files: [
      {
        source: "files/config.json",
        target: "config.json",
        operation: "compose",
        format: "json",
        ...options,
      },
    ],
  });
}
async function output(
  f: Fixture,
  selected: readonly string[],
  previousBundles: readonly LoadedBundle[] = [],
) {
  const resolved = await run(resolveInputs(await f.load(selected), {}));
  const plan = await run(planProject(f.project, resolved, { manager: "npm", previousBundles }));
  const after = plan.files.find((file) => file.path === "config.json")?.after;
  assert.ok(after?.kind === "file");
  return json(Buffer.from(after.base64, "base64").toString());
}
async function writeTarget(f: Fixture, value: object) {
  await fs.writeFile(path.join(f.project, "config.json"), JSON.stringify(value));
}

await test("seed fills absent fields but preserves existing falsy, object, and array values", async (t) => {
  const f = await fixture(t);
  await contribute(
    f,
    "defaults",
    {
      rules: {
        disabled: "error",
        nullable: true,
        zero: 1,
        empty: "default",
        tuple: ["error"],
        missing: "warn",
      },
      settings: { added: true },
    },
    { defaultMode: "seed" },
  );
  await writeTarget(f, {
    rules: { disabled: false, nullable: null, zero: 0, empty: "", tuple: ["off"], local: true },
    settings: { local: true },
  });
  assert.deepEqual(await output(f, ["defaults"]), {
    rules: {
      disabled: false,
      nullable: null,
      zero: 0,
      empty: "",
      tuple: ["off"],
      local: true,
      missing: "warn",
    },
    settings: { local: true, added: true },
  });
});

await test("subtree modes inherit and more-specific modes win without claiming unrelated rules", async (t) => {
  const f = await fixture(t);
  await contribute(
    f,
    "mixed",
    {
      rules: { enforced: "error", optional: "warn", nested: { enforced: true, optional: true } },
      other: true,
    },
    {
      defaultMode: "seed",
      fields: {
        "/rules": { mode: "replace" },
        "/rules/optional": { mode: "seed" },
        "/rules/nested/optional": { mode: "seed" },
      },
    },
  );
  await writeTarget(f, {
    rules: {
      enforced: "off",
      optional: "off",
      local: true,
      nested: { enforced: false, optional: false },
    },
    other: false,
  });
  assert.deepEqual(await output(f, ["mixed"]), {
    rules: {
      enforced: "error",
      optional: "off",
      local: true,
      nested: { enforced: true, optional: false },
    },
    other: false,
  });
});

await test("seeded values survive updates and deselection while enforced fields are removed", async (t) => {
  const f = await fixture(t);
  await contribute(
    f,
    "mixed",
    { rules: { optional: "warn", enforced: "error" }, list: ["initial"] },
    {
      defaultMode: "seed",
      fields: { "/rules/enforced": { mode: "replace" } },
    },
  );
  const initial = await f.load(["mixed"]);
  const created = await output(f, ["mixed"]);
  await writeTarget(f, created);
  await contribute(
    f,
    "mixed",
    { rules: { optional: "error", enforced: "warn" }, list: ["updated"] },
    {
      defaultMode: "seed",
      fields: { "/rules/enforced": { mode: "replace" } },
    },
  );
  const updated = await output(f, ["mixed"], initial.bundles);
  assert.deepEqual(updated, { rules: { optional: "warn", enforced: "warn" }, list: ["initial"] });
  await writeTarget(f, updated);
  assert.deepEqual(await output(f, [], (await f.load(["mixed"])).bundles), {
    rules: { optional: "warn" },
    list: ["initial"],
  });
});

await test("changing replace to seed hands off the current project value", async (t) => {
  const f = await fixture(t);
  await contribute(f, "policy", { rules: { choice: "error" }, list: ["policy"] });
  const prior = await f.load(["policy"]);
  await writeTarget(f, { rules: { choice: "project" }, list: ["local", "policy"] });
  await contribute(
    f,
    "policy",
    { rules: { choice: "warn" }, list: ["default"] },
    { defaultMode: "seed" },
  );
  assert.deepEqual(await output(f, ["policy"], prior.bundles), {
    rules: { choice: "project" },
    list: ["local", "policy"],
  });
});

for (const mode of ["seed", "replace"]) {
  await test(`${mode} reports incompatible project parents instead of overwriting them`, async (t) => {
    const f = await fixture(t);
    await contribute(f, "policy", { rules: { choice: "error" } }, { defaultMode: mode });
    await writeTarget(f, { rules: false });
    await assert.rejects(output(f, ["policy"]), /non-object project value/);
  });
}

await test("different ownership modes conflict even when bundles supply identical values", async (t) => {
  const f = await fixture(t);
  await contribute(f, "defaults", { rules: { choice: "error" } }, { defaultMode: "seed" });
  await contribute(f, "strict", { rules: { choice: "error" } });
  await assert.rejects(output(f, ["defaults", "strict"]), /Incompatible composition declarations/);
});

await test("explicit bundle replacement supersedes both value and ownership, then restores the seed", async (t) => {
  const f = await fixture(t);
  await contribute(f, "defaults", { rules: { choice: "warn" } }, { defaultMode: "seed" });
  await contribute(
    f,
    "strict",
    { rules: { choice: "error" } },
    {
      fields: { "/rules/choice": { replaces: "defaults" } },
    },
  );
  const selected = await f.load(["defaults", "strict"]);
  await writeTarget(f, { rules: { choice: "off" } });
  assert.deepEqual(await output(f, ["defaults", "strict"]), { rules: { choice: "error" } });
  await writeTarget(f, { rules: { choice: "error" } });
  assert.deepEqual(await output(f, ["defaults"], selected.bundles), { rules: { choice: "error" } });
  await writeTarget(f, {});
  assert.deepEqual(await output(f, ["defaults"]), { rules: { choice: "warn" } });
});

await test("object replacement supersedes inherited ownership and nested field settings", async (t) => {
  const f = await fixture(t);
  await contribute(f, "defaults", { rules: { a: "warn", b: "warn" } }, { defaultMode: "seed" });
  await contribute(
    f,
    "strict",
    { rules: { a: "error", b: "error" } },
    {
      fields: { "/rules": { replaces: "defaults" }, "/rules/b": { mode: "seed" } },
    },
  );
  await writeTarget(f, { rules: { a: "off", b: "off", local: true } });
  assert.deepEqual(await output(f, ["defaults", "strict"]), {
    rules: { a: "error", b: "off", local: true },
  });
});

await test("append arrays manage only contributed items across updates and removal", async (t) => {
  const f = await fixture(t);
  const options = {
    defaultMode: "seed",
    fields: { "/ignores": { mode: "replace", merge: "append-unique" } },
  };
  await contribute(f, "policy", { ignores: ["dist", "coverage"] }, options);
  await writeTarget(f, { ignores: ["local", "dist"] });
  const prior = await f.load(["policy"]);
  assert.deepEqual(await output(f, ["policy"]), { ignores: ["local", "dist", "coverage"] });
  await writeTarget(f, { ignores: ["local", "dist", "coverage", "custom"] });
  await contribute(f, "policy", { ignores: ["build", "coverage"] }, options);
  const updated = await output(f, ["policy"], prior.bundles);
  assert.deepEqual(updated, { ignores: ["local", "custom", "build", "coverage"] });
  await writeTarget(f, updated);
  assert.deepEqual(await output(f, [], (await f.load(["policy"])).bundles), {
    ignores: ["local", "custom"],
  });
});

await test("atomic arrays replace the whole value when no merge is declared", async (t) => {
  const f = await fixture(t);
  await contribute(f, "policy", { rule: ["error", { option: true }] });
  await writeTarget(f, { rule: ["off"] });
  assert.deepEqual(await output(f, ["policy"]), { rule: ["error", { option: true }] });
});

await test("seeds refill deleted fields but preserve existing empty parents on removal", async (t) => {
  const f = await fixture(t);
  await contribute(f, "defaults", { rules: { choice: "warn" } }, { defaultMode: "seed" });
  const prior = await f.load(["defaults"]);
  await writeTarget(f, { rules: {} });
  assert.deepEqual(await output(f, [], prior.bundles), { rules: {} });
  assert.deepEqual(await output(f, ["defaults"], prior.bundles), { rules: { choice: "warn" } });
});

await test("enforcement can take ownership of a previously seeded value", async (t) => {
  const f = await fixture(t);
  await contribute(f, "policy", { choice: "warn" }, { defaultMode: "seed" });
  const prior = await f.load(["policy"]);
  await writeTarget(f, { choice: "off", local: true });
  await contribute(f, "policy", { choice: "error" });
  assert.deepEqual(await output(f, ["policy"], prior.bundles), { choice: "error", local: true });
  await writeTarget(f, { choice: "edited", local: true });
  assert.deepEqual(await output(f, [], (await f.load(["policy"])).bundles), { local: true });
});

await test("independent object fragments retain their own inherited modes in either selection order", async (t) => {
  const f = await fixture(t);
  await contribute(f, "one", { rules: { optional: "warn" } }, { defaultMode: "seed" });
  await contribute(f, "two", { rules: { enforced: "error" } });
  await writeTarget(f, { rules: { optional: "off", enforced: "off", local: true } });
  const expected = { rules: { optional: "off", enforced: "error", local: true } };
  assert.deepEqual(await output(f, ["one", "two"]), expected);
  assert.deepEqual(await output(f, ["two", "one"]), expected);
});

await test("explicit replacement can change an atomic seeded array into managed appended items", async (t) => {
  const f = await fixture(t);
  await contribute(f, "defaults", { values: ["default"] }, { defaultMode: "seed" });
  await contribute(
    f,
    "strict",
    { values: ["enforced"] },
    {
      fields: { "/values": { mode: "replace", merge: "append-unique", replaces: "defaults" } },
    },
  );
  await writeTarget(f, { values: ["local"] });
  assert.deepEqual(await output(f, ["defaults", "strict"]), { values: ["local", "enforced"] });
});

await test("append arrays reject existing non-array values", async (t) => {
  const f = await fixture(t);
  await contribute(
    f,
    "policy",
    { values: ["policy"] },
    { fields: { "/values": { merge: "append-unique" } } },
  );
  await writeTarget(f, { values: false });
  await assert.rejects(output(f, ["policy"]), /non-array project value/);
});

await test("identical replacements coalesce but differing replacement ownership fails", async (t) => {
  const f = await fixture(t);
  await contribute(f, "base-rule", { choice: "warn" }, { defaultMode: "seed" });
  const fields = { "/choice": { replaces: "base-rule" } };
  await contribute(f, "one", { choice: "error" }, { fields });
  await contribute(f, "two", { choice: "error" }, { fields });
  assert.deepEqual(await output(f, ["base-rule", "one", "two"]), { choice: "error" });
  await contribute(f, "two", { choice: "error" }, { defaultMode: "seed", fields });
  await assert.rejects(output(f, ["base-rule", "one", "two"]), /Conflicting replacements/);
});

await test("replacement chains and overlapping replacements fail regardless of bundle order", async (t) => {
  const f = await fixture(t);
  await contribute(f, "base-rule", { rules: { choice: "warn" } });
  await contribute(
    f,
    "one",
    { rules: { choice: "error" } },
    { fields: { "/rules/choice": { replaces: "base-rule" } } },
  );
  await contribute(
    f,
    "two",
    { rules: { choice: "off" } },
    { fields: { "/rules/choice": { replaces: "one" } } },
  );
  await assert.rejects(output(f, ["base-rule", "one", "two"]), /Replacement chains/);
  await contribute(
    f,
    "two",
    { rules: { choice: "off" } },
    { fields: { "/rules": { replaces: "base-rule" } } },
  );
  await assert.rejects(output(f, ["base-rule", "one", "two"]), /Overlapping replacements/);
});

await test("seeding existing values leaves target comments and formatting untouched", async (t) => {
  const f = await fixture(t);
  await contribute(f, "defaults", { choice: "warn" }, { defaultMode: "seed" });
  const content = '{\n  // Project choice\n  "choice": "off",\n}\n';
  await fs.writeFile(path.join(f.project, "config.json"), content);
  const resolved = await run(resolveInputs(await f.load(["defaults"]), {}));
  const plan = await run(planProject(f.project, resolved, { manager: "npm" }));
  const file = plan.files.find((entry) => entry.path === "config.json");
  assert.equal(file?.kind, "noop");
  assert.deepEqual(file?.after, file?.before);
});

await test("append arrays remove duplicate source items even when their parent is absent", async (t) => {
  const f = await fixture(t);
  await contribute(
    f,
    "policy",
    { nested: { values: ["a", "a", "b"] } },
    {
      fields: { "/nested/values": { merge: "append-unique" } },
    },
  );
  assert.deepEqual(await output(f, ["policy"]), { nested: { values: ["a", "b"] } });
});
