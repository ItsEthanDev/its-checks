import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { fullFormats } from "ajv-formats/dist/formats.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Effect } from "effect";
import { parse } from "jsonc-parser";

import { loadPolicy } from "../src/bundles.ts";
import { enumerateInputs, resolveInputs } from "../src/inputs.ts";
import { decodeSavedIntent, loadPreviousIntent, selectionFilename } from "../src/selections.ts";
import { fixture, snapshot } from "./fixtures.ts";

const run = Effect.runPromise;
const empty = { integrations: [], automation: [] };
const input = (
  id: string,
  type: string,
  field: readonly (string | number)[],
  defaultValue?: string | number | boolean,
) => ({
  id,
  prompt: `Enter ${id}`,
  type,
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
  destination: { file: "config.jsonc", field },
});

async function inputPolicy(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t);
  await f.add("base", {
    name: "Baseline",
    inputs: [
      input("label", "string", ["label"], "starter"),
      input("limit", "number", ["limits", 0]),
    ],
  });
  await f.write(
    "typescript/base/files/config.jsonc",
    '{\n// preserve this comment\n"label": "authored", "limits": [1], "fixed": "not a question"\n}\n',
  );
  await f.add("integrations/tailwind", {
    name: "Tailwind",
    inputs: [input("stylesheet", "path", ["stylesheet"], "src/default.css")],
  });
  await f.write("typescript/integrations/tailwind/files/config.jsonc", {
    stylesheet: "authored.css",
  });
  await f.add("automation/ci", {
    name: "CI",
    inputs: [input("enabled", "boolean", ["enabled"], true)],
  });
  await f.write("typescript/automation/ci/files/config.jsonc", { enabled: false });
  await f.write("typescript/automation/ci/files/workflow.yaml", 'name: "${label}"\non: push\n');
  await f.write("typescript/automation/ci/files/hook.sh", 'echo "${label}"\n');
  return f;
}
const all = { integrations: ["tailwind"], automation: ["ci"] };
const answers = {
  base: { label: "project", limit: 0 },
  "integrations/tailwind": { stylesheet: "src/not-created-yet.css" },
  "automation/ci": { enabled: false },
};

test("first use enumerates every selected bundle and resolves explicit native values without mutation", async (t) => {
  const f = await inputPolicy(t);
  const before = await snapshot(f.project);
  assert.equal(await run(loadPreviousIntent(f.project)), undefined);
  const policy = await run(loadPolicy(f.policy, all));
  const original = structuredClone(policy);
  const questions = await run(enumerateInputs(policy));
  assert.deepEqual(
    questions.map((q) => [q.bundle, q.input.id, q.initialValue]),
    [
      ["base", "label", "starter"],
      ["base", "limit", undefined],
      ["integrations/tailwind", "stylesheet", "src/default.css"],
      ["automation/ci", "enabled", true],
    ],
  );
  const resolved = await run(resolveInputs(policy, answers));
  const files = resolved.policy.bundles[0]!.files;
  const native = files.find((file) => file.path === "config.jsonc")!;
  assert.deepEqual(parse(native.content), {
    label: "project",
    limits: [0],
    fixed: "not a question",
  });
  assert.ok(native.format === "jsonc");
  assert.deepEqual(native.value, parse(native.content));
  assert.match(native.content, /preserve this comment/);
  const automation = resolved.policy.bundles[2]!.files;
  assert.equal(
    automation.find((file) => file.format === "yaml")!.content,
    'name: "${label}"\non: push\n',
  );
  assert.equal(automation.find((file) => file.format === "shell")!.content, 'echo "${label}"\n');
  assert.deepEqual(policy, original);
  assert.deepEqual(await snapshot(f.project), before);
  assert.equal(resolved.selectionFile.path, ".its-checks.json");
  assert.deepEqual(await run(decodeSavedIntent(resolved.selectionFile.content)), resolved.intent);
  assert.equal(
    resolved.intent.$schema,
    "https://github.com/example/fork/raw/main/schemas/its-checks.schema.json",
  );
  assert.deepEqual(resolved.intent, {
    $schema: "https://github.com/example/fork/raw/main/schemas/its-checks.schema.json",
    source: "https://github.com/example/fork",
    integrations: ["tailwind"],
    automation: ["ci"],
    answers,
  });
});

test("offline saved intent is returned for preselection/prefill, changed answers bind afresh, deselection drops stale answers", async (t) => {
  const f = await inputPolicy(t);
  const policy = await run(loadPolicy(f.policy, all));
  const first = await run(resolveInputs(policy, answers));
  // The file is written by the test, not by either public seam; loading remains offline.
  await fs.writeFile(path.join(f.project, selectionFilename), first.selectionFile.content);
  const previous = await run(loadPreviousIntent(f.project));
  assert.deepEqual(previous?.integrations, ["tailwind"]);
  assert.deepEqual(previous?.automation, ["ci"]);
  assert.deepEqual(
    (await run(enumerateInputs(policy, previous))).map((q) => q.initialValue),
    ["project", 0, "src/not-created-yet.css", false],
  );
  assert.deepEqual(
    (
      await run(
        enumerateInputs(policy, {
          ...previous,
          answers: { ...answers, base: { label: "", limit: 0 } },
        }),
      )
    ).map((q) => q.initialValue),
    ["", 0, "src/not-created-yet.css", false],
  );
  await assert.rejects(run(resolveInputs(policy, {})), /Missing explicit answer/);
  const changed = await run(
    resolveInputs(policy, { ...answers, base: { label: "changed", limit: 8 } }),
  );
  assert.deepEqual(
    parse(changed.policy.bundles[0]!.files.find((file) => file.path === "config.jsonc")!.content),
    { label: "changed", limits: [8], fixed: "not a question" },
  );
  const baseline = await run(loadPolicy(f.policy, empty));
  assert.deepEqual(
    (await run(enumerateInputs(baseline, previous))).map((q) => q.input.id),
    ["label", "limit"],
  );
  const deselected = await run(resolveInputs(baseline, { base: answers.base }));
  assert.deepEqual(deselected.intent.integrations, []);
  assert.deepEqual(deselected.intent.automation, []);
  assert.deepEqual(deselected.intent.answers, { base: answers.base });
  await assert.rejects(run(resolveInputs(baseline, answers)), /not declared by a selected bundle/);
});

test("invalid answers fail with bundle/input context before touching the project", async (t) => {
  const f = await inputPolicy(t);
  const policy = await run(loadPolicy(f.policy, all));
  const before = await snapshot(f.project);
  for (const [bad, pattern] of [
    [
      { ...answers, base: { label: "x", limit: "12" } },
      /base.*answers.base.limit.*requires number/,
    ],
    [{ ...answers, base: { label: "x", limit: Infinity } }, /finite/i],
    [{ ...answers, "automation/ci": { enabled: "false" } }, /automation\/ci.*requires boolean/],
    [
      { ...answers, "integrations/tailwind": { stylesheet: "../outside.css" } },
      /target-package-relative/,
    ],
    [
      { ...answers, "integrations/tailwind": { stylesheet: "/absolute.css" } },
      /target-package-relative/,
    ],
    [{ ...answers, base: { ...answers.base, extra: "x" } }, /not declared/],
    [{ ...answers, "bad namespace": {} }, /namespaced|excess|unexpected/i],
  ] as const)
    {await assert.rejects(run(resolveInputs(policy, bad)), pattern);}
  const previous = (await run(resolveInputs(policy, answers))).intent;
  await assert.rejects(
    run(
      enumerateInputs(policy, {
        ...previous,
        answers: { ...answers, base: { label: false, limit: 2 } },
      }),
    ),
    /saved answers.base.label.*requires string/,
  );
  assert.deepEqual(await snapshot(f.project), before);
});

test("malformed local intent is never treated as first use or trusted via a remote schema", async (t) => {
  const f = await fixture(t);
  const intent = (await run(resolveInputs(await run(loadPolicy(f.policy, empty)), {}))).intent;
  const valid = JSON.stringify(intent);
  const malformed = [
    "{broken",
    JSON.stringify({ ...intent, schemaVersion: 2 }),
    JSON.stringify({
      ...intent,
      schemaVersion: 1,
      source: { repository: intent.source, selectionSchema: "schemas/its-checks.schema.json" },
    }),
    valid.replace('"answers":{}', '"answers":{"base":{"bad":null}}'),
    valid.replace('"answers":{}', '"answers":{"base":{"bad":[]}}'),
    valid.replace('"answers":{}', '"answers":{"base":{"bad":1e999}}'),
    valid.replace('"answers":{}', '"answers":{"other":{}}'),
    valid.replace('"integrations":[]', '"integrations":["a","a"]'),
    valid.replace('"answers":{}', '"answers":{},"ownership":[]'),
    valid.replace('"answers":{}', '"answers":{},"answers":{}'),
    valid.replace('"answers":{}', '"answers":{"__proto__":{}}'),
    JSON.stringify({ ...intent, $schema: "file:///private/schema.json" }),
    JSON.stringify({ ...intent, source: "https://user:password@example.com/repo" }),
    JSON.stringify({ ...intent, commit: "main" }),
    JSON.stringify({ ...intent, commit: "a".repeat(7) }),
    JSON.stringify({ ...intent, commit: null }),
  ];
  for (const content of malformed) {
    await fs.writeFile(path.join(f.project, selectionFilename), content);
    const before = await snapshot(f.project);
    await assert.rejects(run(loadPreviousIntent(f.project)), /selections.*\.its-checks.json/);
    assert.deepEqual(await snapshot(f.project), before);
  }
  await fs.rm(path.join(f.project, selectionFilename));
  await fs.symlink(path.join(f.project, "package.json"), path.join(f.project, selectionFilename));
  await assert.rejects(run(loadPreviousIntent(f.project)), /regular file/);
});

test("saved intent preserves the generating commit and input prefills without rewriting on read", async (t) => {
  const f = await inputPolicy(t);
  const policy = await run(loadPolicy(f.policy, all));
  const current = await run(resolveInputs(policy, answers, "b".repeat(40)));
  assert.deepEqual(current.intent, {
    $schema: "https://github.com/example/fork/raw/main/schemas/its-checks.schema.json",
    source: "https://github.com/example/fork",
    commit: "b".repeat(40),
    ...all,
    answers,
  });
  assert.deepEqual(await run(decodeSavedIntent(current.selectionFile.content)), current.intent);
  await fs.writeFile(path.join(f.project, selectionFilename), current.selectionFile.content);
  const before = await snapshot(f.project);
  const saved = await run(loadPreviousIntent(f.project));
  assert.deepEqual(saved, current.intent);
  assert.deepEqual(
    (await run(enumerateInputs(policy, saved))).map((question) => question.initialValue),
    ["project", 0, "src/not-created-yet.css", false],
  );
  assert.deepEqual(await snapshot(f.project), before);
});

test("current intent keeps the editor schema independent of the optional generating commit", async (t) => {
  const f = await fixture(t);
  const intent = (
    await run(resolveInputs(await run(loadPolicy(f.policy, empty)), {}, "c".repeat(64)))
  ).intent;
  const saved = { ...intent, $schema: "https://unreachable.invalid/editor-schema.json" };
  assert.deepEqual(
    await run(decodeSavedIntent(JSON.stringify(saved))),
    saved,
    "no runtime fetch or inferred schema/commit equality",
  );
});

test("invalid native input bindings fail before mutation, including overlapping and incorrectly typed field paths", async (t) => {
  const f = await fixture(t);
  const before = await snapshot(f.project);
  for (const declaration of [
    { name: "Base", inputs: [input("missing", "string", ["absent"])] },
    { name: "Base", inputs: [input("array", "string", ["items", "0"])] },
    {
      name: "Base",
      inputs: [
        input("parent", "string", ["nested"]),
        input("child", "string", ["nested", "value"]),
      ],
    },
    {
      name: "Base",
      inputs: [
        {
          ...input("yaml", "string", ["name"]),
          destination: { file: "workflow.yaml", field: ["name"] },
        },
      ],
    },
  ]) {
    await f.add("base", declaration);
    await f.write("typescript/base/files/config.jsonc", { items: [1], nested: { value: "x" } });
    await f.write("typescript/base/files/workflow.yaml", "name: authored\n");
    await assert.rejects(
      run(
        Effect.gen(function* () {
          const policy = yield* loadPolicy(f.policy, empty);
          return yield* resolveInputs(policy, {
            base: { missing: "x", array: "x", parent: "x", child: "y", yaml: "x" },
          });
        }),
      ),
      /inputs.*destination|JSON\/JSONC/,
    );
    assert.deepEqual(await snapshot(f.project), before);
  }
});

test("JSON binding treats input IDs as own map keys and preserves target-root path strings", async (t) => {
  const f = await fixture(t);
  await f.add("base", {
    name: "Base",
    inputs: [
      {
        ...input("constructor", "path", ["stylesheet"], "src/default.css"),
        destination: { file: "config.json", field: ["stylesheet"] },
      },
    ],
  });
  await f.write("typescript/base/files/config.json", { stylesheet: false, fixed: true });
  const policy = await run(loadPolicy(f.policy, empty));
  const saved = (await run(resolveInputs(policy, { base: { constructor: "src/first.css" } })))
    .intent;
  const previous = { ...saved, answers: { base: {} } };
  assert.equal((await run(enumerateInputs(policy, previous)))[0]!.initialValue, "src/default.css");
  await assert.rejects(run(resolveInputs(policy, { base: {} })), /Missing explicit answer/);
  const resolved = await run(resolveInputs(policy, { base: { constructor: "src/new.css" } }));
  const file = resolved.policy.bundles[0]!.files.find((file) => file.path === "config.json")!;
  assert.deepEqual(JSON.parse(file.content), { stylesheet: "src/new.css", fixed: true });
  assert.deepEqual(resolved.intent.answers, { base: { constructor: "src/new.css" } });
});

test("the editor schema accepts generated intent with optional provenance and rejects malformed intent", async (t) => {
  const f = await fixture(t);
  const generated = await run(resolveInputs(await run(loadPolicy(f.policy, empty)), {}));
  const schema = JSON.parse(
    await fs.readFile(new URL("../schemas/its-checks.schema.json", import.meta.url), "utf8"),
  );
  const ajv = new Ajv2020({ formats: fullFormats });
  const validate = ajv.compile(schema);
  const valid = {
    ...generated.intent,
    integrations: ["example"],
    automation: ["ci"],
    answers: {
      base: { label: "project", count: 0, enabled: false },
      "integrations/example": { stylesheet: "src/app.css" },
    },
  };
  for (const intent of [
    generated.intent,
    valid,
    { ...valid, commit: "b".repeat(40) },
    { ...valid, commit: "c".repeat(64) },
  ]) {
    assert.equal(validate(intent), true, ajv.errorsText(validate.errors));
  }
  for (const field of ["$schema", "source", "integrations", "automation", "answers"] as const) {
    const missing: Record<string, unknown> = { ...valid };
    delete missing[field];
    assert.equal(validate(missing), false, `missing ${field} must be rejected`);
  }
  const malformed: [string, object][] = [
    ["unknown property", { ...valid, unexpected: true }],
    ["non-HTTPS schema", { ...valid, $schema: "http://example.com/schema.json" }],
    ["invalid repository URI", { ...valid, source: "https://example.com/invalid path" }],
    ["abbreviated commit", { ...valid, commit: "b".repeat(7) }],
    ["non-string commit", { ...valid, commit: 123 }],
    ["non-array selections", { ...valid, automation: "ci" }],
    ["duplicate selections", { ...valid, integrations: ["example", "example"] }],
    ["invalid selection ID", { ...valid, automation: ["Bad/ID"] }],
    ["invalid answer namespace", { ...valid, answers: { example: { label: "project" } } }],
    ["invalid input ID", { ...valid, answers: { base: { "Bad/ID": true } } }],
    ["non-scalar answer", { ...valid, answers: { base: { label: [] } } }],
  ];
  for (const [requirement, intent] of malformed) {
    assert.equal(validate(intent), false, requirement);
  }
});
