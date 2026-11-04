import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect, Result, Schema } from "effect";

import { BundleError, discoverPolicy, loadPolicy } from "../src/modules/policy/index.ts";
import { defined } from "./assertions.ts";
import { fixture, snapshot } from "./fixtures.ts";
import { invalidDeclarations } from "./invalid-declarations.ts";

const none = { integrations: [], automation: [] };

async function failure(effect: Effect.Effect<unknown, BundleError>) {
  const result = await Effect.runPromise(Effect.result(effect));
  assert.ok(Result.isFailure(result), "expected a typed policy failure, not success");
  assert.ok(Schema.is(BundleError)(result.failure));
  return result.failure;
}

await test("loads baseline plus selected external JSONC, shell and YAML in stable bundle/file order", async (t) => {
  const f = await fixture(t);
  await f.add("integrations/zebra");
  await f.add("integrations/alpha", {
    name: "Alpha",
    description: "Native integration",
    dependencies: { "@example/plugin": "^1.2.0" },
    inputs: [
      {
        id: "stylesheet",
        prompt: "Stylesheet path?",
        type: "path",
        default: "src/app.css",
        destination: { file: ".oxfmtrc.jsonc", field: ["sortTailwindcss", "stylesheet"] },
      },
    ],
  });
  const jsonc = '{\n// authored by fork\n"sortTailwindcss": {"stylesheet": "src/app.css"},\n}\n';
  await f.write("typescript/integrations/alpha/files/.oxfmtrc.jsonc", jsonc);
  await f.add("automation/zed");
  await f.add("automation/actions");
  const yaml = "name: checks\non: [push]\njobs:\n  checks:\n    runs-on: ubuntu-latest\n";
  await f.write("typescript/automation/actions/files/.github/workflows/checks.yml", yaml);
  const shell = '#!/bin/sh\nprintf "policy remains native\\n"\n';
  const hook = await f.write("typescript/automation/zed/files/.husky/pre-commit", shell);
  await fs.chmod(hook, 0o755);
  const before = await snapshot(f.root);
  const loaded = await Effect.runPromise(
    loadPolicy(f.policy, { integrations: ["zebra", "alpha"], automation: ["zed", "actions"] }),
  );
  assert.deepEqual(
    loaded.bundles.map((bundle) => bundle.key),
    ["base", "integrations/alpha", "integrations/zebra", "automation/actions", "automation/zed"],
  );
  assert.equal(loaded.declaration.source.repository, "https://github.com/example/fork");
  assert.deepEqual(loaded.bundles[0]?.declaration.migration, {
    removeFiles: ["prettier.config.js"],
    removeDevDependencies: ["prettier"],
  });
  const native = defined(loaded.bundles[1]?.files[0]);
  assert.equal(native.path, ".oxfmtrc.jsonc");
  assert.equal(native.content, jsonc);
  assert.equal(native.format, "jsonc");
  if (native.format === "jsonc") {
    assert.deepEqual(native.value, { sortTailwindcss: { stylesheet: "src/app.css" } });
  }
  assert.equal(loaded.bundles[3]?.files[0]?.content, yaml);
  assert.equal(loaded.bundles[4]?.files[0]?.content, shell);
  assert.equal(loaded.bundles[4]?.files[0]?.executable, true);
  assert.deepEqual(await snapshot(f.root), before, "loading cannot mutate policy or project");
});

await test("new directories appear without a registry; display names are not identities", async (t) => {
  const f = await fixture(t);
  await f.add("integrations/zebra", { name: "Same display" });
  await f.add("integrations/alpha", { name: "Same display" });
  assert.deepEqual(
    (await Effect.runPromise(discoverPolicy(f.policy))).integrations.map((b) => b.id),
    ["alpha", "zebra"],
  );
  await f.add("integrations/middle", { name: "Added by fork" });
  await f.add("automation/alpha");
  const catalog = await Effect.runPromise(discoverPolicy(f.policy));
  assert.deepEqual(
    catalog.integrations.map((b) => b.id),
    ["alpha", "middle", "zebra"],
  );
  assert.equal(catalog.automation[0]?.key, "automation/alpha");
  assert.deepEqual(
    (await Effect.runPromise(loadPolicy(f.policy, none))).bundles.map((b) => b.key),
    ["base"],
  );
});

await test("baseline and automation declare typed inputs and native files sort independently of creation order", async (t) => {
  const f = await fixture(t);
  await f.add("base", {
    name: "Base",
    inputs: [
      {
        id: "level",
        prompt: "Level?",
        type: "string",
        default: "warn",
        destination: { file: ".oxlintrc.json", field: ["rules", "no-debugger"] },
      },
    ],
  });
  await f.add("automation/custom", {
    name: "Custom automation",
    devDependencies: { "some-tool": ">=1 <2" },
    inputs: [
      {
        id: "enabled",
        prompt: "Enabled?",
        type: "boolean",
        default: true,
        destination: { file: "options.json", field: ["enabled"] },
      },
      {
        id: "count",
        prompt: "Count?",
        type: "number",
        default: 3,
        destination: { file: "options.json", field: ["counts", 0] },
      },
      {
        id: "other",
        prompt: "Other?",
        type: "boolean",
        destination: { file: "options.json", field: ["Enabled"] },
      },
    ],
  });
  await f.write("typescript/automation/custom/files/z.sh", "true\n");
  await f.write("typescript/automation/custom/files/options.json", {
    enabled: false,
    counts: [1],
    Enabled: true,
  });
  await f.write("typescript/automation/custom/files/a.sh", "true\n");
  const policy = await Effect.runPromise(
    loadPolicy(f.policy, { integrations: [], automation: ["custom"] }),
  );
  assert.equal(policy.bundles[0]?.declaration.inputs?.[0]?.id, "level");
  assert.equal(policy.bundles[1]?.declaration.inputs?.length, 3);
  assert.equal(policy.bundles[1]?.declaration.devDependencies?.["some-tool"], ">=1 <2");
  assert.deepEqual(
    policy.bundles[1]?.files.map((file) => file.path),
    ["a.sh", "options.json", "z.sh"],
  );
  // Loading validates declarations but does not bind answers/defaults; that belongs to #4.
  const options = defined(policy.bundles[1]?.files[1]);
  assert.ok(options.format === "json");
  assert.deepEqual(options.value, { enabled: false, counts: [1], Enabled: true });
});

await test("ordinary policy edits change loaded content without implementation changes", async (t) => {
  const f = await fixture(t);
  await f.write("typescript/base/files/.oxlintrc.json", { rules: { "no-debugger": "warn" } });
  const loaded = await Effect.runPromise(loadPolicy(f.policy, none));
  const file = defined(loaded.bundles[0]?.files[0]);
  assert.ok(file.format === "json");
  assert.deepEqual(file.value, { rules: { "no-debugger": "warn" } });
});

await test("only selected native content is loaded; all discovered display declarations are validated", async (t) => {
  const f = await fixture(t);
  await f.add("integrations/optional");
  await f.write("typescript/integrations/optional/files/.oxlintrc.json", "not JSON");
  await Effect.runPromise(loadPolicy(f.policy, none));
  const error = await failure(loadPolicy(f.policy, { integrations: ["optional"], automation: [] }));
  assert.equal(error.bundle, "integrations/optional");
  assert.match(error.source, /optional\/files\/\.oxlintrc\.json$/);
  await f.add("integrations/optional", { name: 99 });
  assert.match((await failure(discoverPolicy(f.policy))).message, /name/);
});

for (const [name, declaration, expected] of invalidDeclarations) {
  await test(`rejects ${name} with source context and no writes or dependency operations`, async (t) => {
    const f = await fixture(t);
    await f.add("base", { name: "Base", ...declaration });
    const before = await snapshot(f.root);
    const error = await failure(loadPolicy(f.policy, none));
    assert.equal(error.bundle, "base");
    assert.equal(error.source, path.join(f.policy, "typescript/base/bundle.json"));
    assert.match(error.message, expected);
    assert.deepEqual(await snapshot(f.root), before);
  });
}

for (const [name, native, content, expected] of [
  ["malformed JSON", ".oxlintrc.json", '{"rules":', /offset/],
  ["JSON duplicate field", ".oxlintrc.json", '{"rules":{},"rules":{}}', /Duplicate object key/],
  ["prototype key", ".oxlintrc.json", '{"__proto__":{"rules":{}}}', /prototype key/],
  ["nonfinite number", ".oxlintrc.json", '{"limit":1e999}', /Nonfinite JSON number/],
  ["declaration in files", "package.json", "{}", /bundle.json/],
  ["nested manifest", "nested/package.json", "{}", /bundle.json/],
  ["case-insensitive manifest", "PACKAGE.JSON", "{}", /bundle.json/],
  [
    "executable JS installer",
    "install.js",
    'throw new Error("never run")',
    /executable installers/,
  ],
  [
    "malformed YAML",
    ".github/workflows/checks.yml",
    "jobs: [\n",
    /YAML|flow sequence|Flow sequence/,
  ],
  ["duplicate YAML", ".github/workflows/checks.yml", "name: one\nname: two\n", /unique/],
  ["unsafe backslash", "bad\\name.json", "{}", /safe target-relative/],
  ["Windows alternate stream", "config:stream.json", "{}", /safe target-relative/],
  ["Windows reserved name", "CON.json", "{}", /safe target-relative/],
  ["Git directory", ".git/config.json", "{}", /safe target-relative/],
] as const) {
  await test(`rejects ${name} native policy before mutation`, async (t) => {
    const f = await fixture(t);
    await f.write(`typescript/base/files/${native}`, content);
    const before = await snapshot(f.root);
    const error = await failure(loadPolicy(f.policy, none));
    assert.equal(error.bundle, "base");
    assert.match(error.message, expected);
    assert.deepEqual(await snapshot(f.root), before);
  });
}

await test("rejects duplicate declaration keys rather than losing their first value", async (t) => {
  const f = await fixture(t);
  await f.write("typescript/base/bundle.json", '{"name":"one","name":"two"}');
  assert.match((await failure(loadPolicy(f.policy, none))).message, /Duplicate object key "name"/);
});

await test("rejects duplicate input IDs and bindings", async (t) => {
  const f = await fixture(t);
  const input = {
    id: "level",
    prompt: "Level?",
    type: "string",
    destination: { file: ".oxlintrc.json", field: ["rules", "no-debugger"] },
  };
  await f.add("base", { name: "Base", inputs: [input, input] });
  assert.match((await failure(loadPolicy(f.policy, none))).message, /inputs.id.*Duplicate/);
  await f.add("base", { name: "Base", inputs: [input, { ...input, id: "other" }] });
  assert.match(
    (await failure(loadPolicy(f.policy, none))).message,
    /inputs.destination.*Duplicate/,
  );
});

await test("rejects duplicate selections, unknown selections and noncanonical directory IDs", async (t) => {
  const f = await fixture(t);
  await f.add("integrations/alpha");
  assert.match(
    (await failure(loadPolicy(f.policy, { integrations: ["alpha", "alpha"], automation: [] })))
      .message,
    /Duplicate/,
  );
  assert.match(
    (await failure(loadPolicy(f.policy, { integrations: ["missing"], automation: [] }))).message,
    /Unknown bundle ID/,
  );
  await f.add("integrations/Alpha");
  assert.match((await failure(discoverPolicy(f.policy))).message, /Duplicate identity/);
});

await test("rejects case-alias native files and symbolic-link files/directories", async (t) => {
  const f = await fixture(t);
  await f.write("typescript/base/files/A.json", {});
  await f.write("typescript/base/files/a.json", {});
  assert.match((await failure(loadPolicy(f.policy, none))).message, /Duplicate identity or path/);
  await fs.rm(path.join(f.policy, "typescript/base/files/A.json"));
  await fs.symlink(
    path.join(f.project, "package.json"),
    path.join(f.policy, "typescript/base/files/link.json"),
  );
  assert.match((await failure(loadPolicy(f.policy, none))).message, /symbolic links/);
  await fs.rm(path.join(f.policy, "typescript/base/files/link.json"));
  await fs.symlink(f.project, path.join(f.policy, "typescript/base/files/linked"));
  assert.match((await failure(loadPolicy(f.policy, none))).message, /symbolic links/);
});

await test("bundle installers are rejected, native hook code is never executed", async (t) => {
  const f = await fixture(t);
  const sentinel = path.join(f.project, "ran");
  await f.write("typescript/base/files/.husky/pre-commit", `#!/bin/sh\ntouch '${sentinel}'\n`);
  await Effect.runPromise(loadPolicy(f.policy, none));
  await assert.rejects(fs.access(sentinel));
  await f.write("typescript/base/install.sh", `touch '${sentinel}'`);
  assert.match((await failure(loadPolicy(f.policy, none))).message, /executable installers/);
  await assert.rejects(fs.access(sentinel));
});

for (const [field, value, expected] of [
  ["repository", "file:///private", /source.repository/],
  ["repository", "https://user:password@example.com/repo", /source.repository/],
  ["selectionSchema", "../schema.json", /source.selectionSchema/],
] as const) {
  await test(`validates root provenance ${field}: ${value}`, async (t) => {
    const f = await fixture(t);
    await f.write("bundle.json", {
      schemaVersion: 1,
      source: {
        repository: "https://example.com/repo",
        selectionSchema: "schema.json",
        [field]: value,
      },
    });
    const error = await failure(loadPolicy(f.policy, none));
    assert.equal(error.bundle, "policy");
    assert.equal(error.source, path.join(f.policy, "bundle.json"));
    assert.match(error.message, expected);
  });
}

await test("missing declarations and invalid UTF-8 are contextual typed failures", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    path.join(f.policy, "typescript/base/files/.oxlintrc.json"),
    Buffer.from([0xff]),
  );
  assert.match((await failure(loadPolicy(f.policy, none))).source, /\.oxlintrc.json$/);
  await fs.rm(path.join(f.policy, "typescript/base/bundle.json"));
  const error = await failure(loadPolicy(f.policy, none));
  assert.match(error.source, /base\/bundle.json$/);
  assert.match(error.message, /ENOENT/);
});
