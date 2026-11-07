import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { fixture, revision, snapshot } from "../../../../test/shared/fixtures.ts";
import { discoverPolicy, decodeSavedIntent } from "../index.ts";
const run = Effect.runPromise;
for (const [label, options] of [
  ["unknown file settings", { arrays: { "/values": "append-unique" } }],
  ["unknown replacement map", { replaces: { "/value": "base" } }],
  ["string field settings", { fields: { "/value": "seed" } }],
  ["unknown field settings", { fields: { "/value": { operation: "seed" } } }],
  ["invalid modes", { defaultMode: "merge" }],
  ["invalid replacement identities", { fields: { "/value": { replaces: "owner/repo:base" } } }],
  ["invalid pointers", { fields: { value: { mode: "seed" } } }],
  ["invalid pointer escapes", { fields: { "/bad~2key": { mode: "seed" } } }],
  ["prototype pointers", { fields: { "/constructor": { mode: "seed" } } }],
  ["missing fields", { fields: { "/missing": { mode: "seed" } } }],
  ["array indexes as fields", { fields: { "/values/0": { mode: "seed" } } }],
  ["non-array merges", { fields: { "/value": { merge: "append-unique" } } }],
  [
    "seeded append arrays",
    { defaultMode: "seed", fields: { "/values": { merge: "append-unique" } } },
  ],
  [
    "inherited seeded append arrays",
    { fields: { "/nested": { mode: "seed" }, "/nested/values": { merge: "append-unique" } } },
  ],
  ["field settings on whole-file operations", { operation: "seed", fields: {} }],
  ["field defaults on whole-file operations", { operation: "replace", defaultMode: "seed" }],
] as const) {
  await test(`policy loading rejects ${label}`, async (t) => {
    const f = await fixture(t);
    await f.add("invalid", { name: "Invalid" });
    await f.write("invalid/files/config.json", {
      value: true,
      values: [1],
      nested: { values: [1] },
    });
    await f.add("invalid", {
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
    await assert.rejects(f.load(["invalid"]));
  });
}
await test("policy loading accepts object-only fields with inherited modes and escaped pointers", async (t) => {
  const f = await fixture(t);
  await f.add("valid", { name: "Valid" });
  await f.write("valid/files/config.json", {
    rules: { "example/rule~name": "error" },
    nested: { values: [1] },
  });
  await f.add("valid", {
    files: [
      {
        source: "files/config.json",
        target: "config.json",
        operation: "compose",
        format: "json",
        defaultMode: "seed",
        fields: {
          "/rules/example~1rule~0name": {},
          "/nested": { mode: "replace" },
          "/nested/values": { merge: "append-unique" },
        },
      },
    ],
  });
  await f.load(["valid"]);
});
await test("flat discovery uses directory identities, descriptions, and no mandatory bundle", async (t) => {
  const f = await fixture(t);
  await f.add("optional", { name: "Display name", description: "Purpose" });
  const before = await snapshot(f.project);
  const catalog = await run(discoverPolicy(f.policy, revision.repository));
  assert.deepEqual(
    catalog.bundles.map((bundle) => bundle.id),
    ["base", "optional"],
  );
  assert.equal(catalog.bundles[1]?.key, "example/fork:optional");
  assert.deepEqual((await f.load([])).bundles, []);
  assert.deepEqual(await snapshot(f.project), before);
});
await test("dependencies are transitive, hidden bundles cannot be selected, explicit intent is distinct", async (t) => {
  const f = await fixture(t);
  await f.add("shared", { name: "Shared", hidden: true, requires: [] });
  await f.add("middle", { name: "Middle", requires: ["shared"] });
  await f.add("top", { name: "Top", requires: ["middle"] });
  const loaded = await f.load(["top"]);
  assert.deepEqual(
    loaded.bundles.map((bundle) => bundle.id),
    ["shared", "middle", "top"],
  );
  assert.deepEqual(loaded.sources[0]?.bundles, ["top"]);
  await assert.rejects(f.load(["shared"]), /dependency-only/);
  assert.deepEqual(
    (await f.load(["middle", "top"])).bundles.map((bundle) => bundle.id),
    ["shared", "middle", "top"],
  );
});
for (const [requires, expression] of [
  [["missing"], /Missing bundle missing/],
  [["top"], /cycle.*top.*top/i],
  [["owner/repo:other"], /source-local/],
] as const) {
  await test(`invalid dependency ${requires.join()} fails`, async (t) => {
    const f = await fixture(t);
    await f.add("top", { name: "Top", requires });
    await assert.rejects(f.load(["top"]), expression);
  });
}
await test("duplicate selections, missing selections and directory aliases fail", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.load(["base", "base"]), /Duplicate/);
  await assert.rejects(f.load(["gone"]), /Missing bundle/);
  await fs.mkdir(path.join(f.policy, "BadName"));
  await assert.rejects(f.load([]), /lowercase/);
});
await test("unselected file content is not loaded and policy code cannot become an installer", async (t) => {
  const f = await fixture(t);
  await f.add("bad", {
    name: "Bad",
    files: [{ source: "files/missing", target: "missing", operation: "replace" }],
  });
  await f.load(["base"]);
  await assert.rejects(f.load(["bad"]), /ENOENT/);
  await fs.writeFile(path.join(f.policy, "bad/install.ts"), 'throw Error("must not execute")');
  await assert.rejects(f.load([]), /installers/);
});
for (const relative of [
  "../escape",
  "/absolute",
  "node_modules/foo",
  ".git/config",
  "C:\\bad",
  ".its-checks.json",
  "package.json",
]) {
  await test(`unsafe or reserved target ${relative}`, async (t) => {
    const f = await fixture(t);
    await f.add("bad", {
      name: "Bad",
      files: [{ source: "files/x", target: relative, operation: "replace" }],
    });
    await assert.rejects(f.load(["bad"]), /safe|dedicated/);
  });
}
await test("symlinked bundle/file parents and duplicate JSON keys fail", async (t) => {
  const f = await fixture(t);
  await f.add("linked", { name: "Linked" });
  await fs.symlink(
    path.join(f.policy, "base/files/.oxlintrc.json"),
    path.join(f.policy, "linked/files"),
  );
  await f.add("linked", { files: [{ source: "files/x", target: "x", operation: "seed" }] });
  await assert.rejects(f.load(["linked"]), /directory/);
  await fs.writeFile(
    path.join(f.policy, "linked/bundle.json"),
    '{"name":"A","name":"B","description":"x"}',
  );
  await assert.rejects(f.load([]), /Duplicate object key/);
});
await test("legacy state is rejected and new sources are canonical and unique", async () => {
  await assert.rejects(run(decodeSavedIntent('{"integrations":[],"automation":[]}')));
  const source = { ...revision, bundles: ["base"], answers: {} };
  assert.deepEqual(
    (await run(decodeSavedIntent(JSON.stringify({ schemaVersion: 2, sources: [source] })))).sources,
    [source],
  );
  await assert.rejects(
    run(decodeSavedIntent(JSON.stringify({ schemaVersion: 2, sources: [source, source] }))),
    /Duplicate/,
  );
  await assert.rejects(
    run(
      decodeSavedIntent(
        JSON.stringify({ schemaVersion: 2, sources: [{ ...source, commit: "main" }] }),
      ),
    ),
    /exact policy commit/,
  );
});
