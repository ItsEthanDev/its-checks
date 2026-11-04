import assert from "node:assert/strict";
import { test } from "node:test";

import { Effect } from "effect";

import { object } from "../../../../test/shared/assertions.ts";
import { fixture, revision } from "../../../../test/shared/fixtures.ts";
import { enumerateInputs, loadPolicy, qualifiedAnswers, resolveInputs } from "../index.ts";
const run = Effect.runPromise;
const input = {
  id: "stylesheet",
  prompt: "Stylesheet?",
  type: "path",
  default: "src/default.css",
  destination: { file: "config.json", field: ["stylesheet"] },
};
async function setup(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t);
  await f.add("extra", { name: "Extra", inputs: [input] });
  await f.write("extra/files/config.json", { stylesheet: "placeholder" });
  return f;
}
await test("inputs include dependencies; defaults are suggestions, not implicit headless answers", async (t) => {
  const f = await setup(t);
  const loaded = await f.load(["extra"]);
  assert.equal((await run(enumerateInputs(loaded)))[0]?.initialValue, "src/default.css");
  await assert.rejects(run(resolveInputs(loaded, {})), /Missing explicit/);
  const resolved = await run(
    resolveInputs(loaded, { "example/fork:extra": { stylesheet: "src/app.css" } }),
  );
  const file = resolved.policy.bundles.find((bundle) => bundle.id === "extra")?.files[0];
  assert.equal(file?.format === "json" && object(file.value).stylesheet, "src/app.css");
  assert.deepEqual(resolved.intent.sources[0]?.bundles, ["extra"]);
  assert.deepEqual(resolved.intent.sources[0]?.answers, { extra: { stylesheet: "src/app.css" } });
  assert.equal(
    (await run(enumerateInputs(loaded, resolved.intent)))[0]?.initialValue,
    "src/app.css",
  );
});
for (const answer of [1, false, "../bad.css", "/absolute", "C:\\bad"]) {
  await test(`invalid path answer ${String(answer)}`, async (t) => {
    const f = await setup(t);
    await assert.rejects(
      run(resolveInputs(await f.load(["extra"]), { "example/fork:extra": { stylesheet: answer } })),
      /requires/,
    );
  });
}
await test("stale/unknown answers fail headless resolution; invalid saved answers prompt again", async (t) => {
  const f = await setup(t);
  const loaded = await f.load(["extra"]);
  await assert.rejects(
    run(resolveInputs(loaded, { "example/fork:base": { stale: "x" } })),
    /not declared/,
  );
  const previous = {
    schemaVersion: 2 as const,
    sources: [{ ...f.config(["extra"]), answers: { extra: { stylesheet: false } } }],
  };
  assert.equal((await run(enumerateInputs(loaded, previous)))[0]?.initialValue, "src/default.css");
});
await test("same bundle and input IDs in different sources remain independent", async (t) => {
  const f = await setup(t);
  const a = await f.load(["extra"]);
  const b = await run(loadPolicy(f.policy, ["extra"], { ...revision, repository: "other/policy" }));
  const sources = [
    { ...f.config(["extra"]), answers: { extra: { stylesheet: "a.css" } } },
    {
      ...f.config(["extra"]),
      repository: "other/policy",
      answers: { extra: { stylesheet: "b.css" } },
    },
  ];
  const resolved = await run(
    resolveInputs(
      {
        root: a.root,
        sources: [...a.sources, ...b.sources],
        bundles: [...a.bundles, ...b.bundles],
      },
      qualifiedAnswers(sources),
    ),
  );
  assert.equal(resolved.intent.sources[0]?.answers.extra?.stylesheet, "a.css");
  assert.equal(resolved.intent.sources[1]?.answers.extra?.stylesheet, "b.css");
});
await test("input fields must exist and overlapping bindings fail", async (t) => {
  const f = await setup(t);
  await f.add("extra", { inputs: [input, { ...input, id: "other" }] });
  await assert.rejects(f.load(["extra"]), /Duplicate input destination/);
  await f.add("extra", {
    inputs: [{ ...input, destination: { file: "config.json", field: ["missing"] } }],
  });
  await assert.rejects(run(enumerateInputs(await f.load(["extra"]))), /must exist/);
});
