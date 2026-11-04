import assert from "node:assert/strict";
import { test } from "node:test";

import { Effect } from "effect";

import { planProject } from "../src/modules/planning/index.ts";
import { setup, value } from "./planning-fixtures.ts";

const run = Effect.runPromise;

await test("native fragments compose in stable category order with atomic rules, ordered deduplication and overrides", async (t) => {
  const f = await setup(t);
  await f.write("typescript/base/files/.oxlintrc.json", {
    rules: { tuple: ["warn", { allow: ["base"], nested: { base: true } }], baseline: "error" },
    plugins: ["typescript"],
    jsPlugins: [{ name: "p", specifier: "package" }],
    extends: ["./node_modules/preset/base.json"],
    overrides: [{ files: ["base/**"], rules: { tuple: "off" } }],
    settings: { plugin: { baseline: true }, retained: 1 },
    options: { typeAware: true },
    ignorePatterns: ["base"],
  });
  await f.write("typescript/base/files/.oxfmtrc.jsonc", {
    sortImports: { groups: ["base"], newlinesBetween: 1 },
    ignorePatterns: ["base"],
    overrides: [{ files: ["base/**"], options: { semi: true } }],
  });
  for (const key of ["integrations/z", "integrations/a", "automation/ci"]) {
    await f.add(key);
  }
  await f.write("typescript/integrations/a/files/.oxlintrc.json", {
    rules: { tuple: ["error", { allow: ["a"] }] },
    plugins: ["typescript", "react"],
    jsPlugins: [{ specifier: "package", name: "p" }, "other"],
    extends: ["./node_modules/preset/base.json", "./node_modules/preset/a.json"],
    settings: { plugin: { replaced: true } },
    options: { typeAware: false },
    ignorePatterns: ["base", "a", "a"],
    overrides: [{ files: ["a/**"], rules: { tuple: ["warn", {}] } }],
  });
  await f.write("typescript/integrations/z/files/.oxlintrc.jsonc", {
    rules: { tuple: ["error", { allow: ["z"] }] },
    overrides: [{ files: ["z/**"] }],
  });
  await f.write("typescript/automation/ci/files/.oxlintrc.json", {
    globals: { window: "readonly" },
    overrides: [{ files: ["ci/**"] }],
  });
  await f.write("typescript/integrations/a/files/.oxfmtrc.json", {
    sortImports: { groups: ["a"] },
    ignorePatterns: ["base", "a", "a"],
    overrides: [{ files: ["a/**"], options: { semi: false } }],
  });
  const first = await run(
    planProject(f.project, await f.resolve({ integrations: ["z", "a"], automation: ["ci"] })),
  );
  const second = await run(
    planProject(f.project, await f.resolve({ integrations: ["a", "z"], automation: ["ci"] })),
  );
  assert.deepEqual(first, second);
  assert.deepEqual(value(first, ".oxlintrc.json"), {
    rules: { baseline: "error", tuple: ["error", { allow: ["z"] }] },
    plugins: ["typescript", "react"],
    jsPlugins: [{ name: "p", specifier: "package" }, "other"],
    extends: ["./node_modules/preset/base.json", "./node_modules/preset/a.json"],
    settings: { plugin: { replaced: true }, retained: 1 },
    options: { typeAware: false },
    ignorePatterns: ["base", "a"],
    globals: { window: "readonly" },
    overrides: [
      { files: ["base/**"], rules: { tuple: "off" } },
      { files: ["a/**"], rules: { tuple: ["warn", {}] } },
      { files: ["z/**"] },
      { files: ["ci/**"] },
    ],
  });
  assert.deepEqual(value(first, ".oxfmtrc.json"), {
    sortImports: { groups: ["a"] },
    ignorePatterns: ["base", "a"],
    overrides: [
      { files: ["base/**"], options: { semi: true } },
      { files: ["a/**"], options: { semi: false } },
    ],
  });
});
