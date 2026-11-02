import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { applyPlan } from "../src/application.ts";
import { discoverPolicy, loadPolicy } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject } from "../src/planning.ts";
import { createScriptPlanner } from "../src/scripts.ts";
import { loadPreviousIntent } from "../src/selections.ts";
import { defined, json, object, strings, manifest as parseManifest } from "./assertions.ts";

const run = Effect.runPromise;
// Fixed, test-owned native policy; operational policy/ choices are not test expectations.
const referencePolicy = path.resolve("test/fixtures/policies/reference");
const all = { integrations: ["tailwind"], automation: ["husky", "github-actions"] };
const answers = {
  "integrations/tailwind": {
    "formatter-stylesheet": "src/theme.css",
    "linter-stylesheet": "src/theme.css",
  },
};
const noInstall = {
  assess: () => Effect.succeed("not-required" as const),
  install: () => Effect.die("Unexpected installation"),
};

// Approved seams: discovery, planning and application with native policy; dependency effects only are substituted.
await test("reference policy composes, preserves shared content, reruns, and removes only current-known deselections", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-policy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { check: "echo original" }, custom: true }),
  );
  await fs.mkdir(path.join(root, ".husky"));
  await fs.writeFile(path.join(root, ".husky/pre-commit"), "echo unrelated\n");
  await fs.mkdir(path.join(root, ".github/workflows"), { recursive: true });
  await fs.writeFile(path.join(root, ".github/workflows/app.yml"), "name: untouched\n");
  await fs.writeFile(
    path.join(root, "prettier.config.js"),
    "throw Error('never evaluate migration');\n",
  );
  const loaded = await run(loadPolicy(referencePolicy, all));
  const resolved = await run(resolveInputs(loaded, answers));
  const options = { scripts: createScriptPlanner("npm") };
  const initial = await run(planProject(root, resolved, options));
  assert.equal(initial.complete, true);
  assert.equal(initial.requiresConfirmation, true);
  assert.equal(
    (await run(applyPlan(initial, { approved: true, dependencies: noInstall }))).status,
    "completed",
  );
  const manifest = parseManifest(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.custom, true);
  assert.match(defined(manifest.scripts.check), /echo original/);
  assert.equal(manifest.devDependencies.oxlint, "1.90.0");
  assert.equal(manifest.devDependencies["eslint-plugin-tailwindcss"], "4.4.0");
  const lint = json(await fs.readFile(path.join(root, ".oxlintrc.json"), "utf8"));
  assert.equal(object(lint.rules)["no-debugger"], "error");
  assert.equal(object(lint.rules)["tailwindcss/no-contradicting-classname"], "error");
  assert.deepEqual(lint.jsPlugins, ["eslint-plugin-tailwindcss"]);
  assert.equal(object(object(lint.settings).tailwindcss).cssConfigPath, "src/theme.css");
  const format = json(await fs.readFile(path.join(root, ".oxfmtrc.json"), "utf8"));
  assert.equal(object(format.sortTailwindcss).stylesheet, "src/theme.css");
  assert.match(
    await fs.readFile(path.join(root, ".husky/pre-commit"), "utf8"),
    /^echo unrelated\n/,
  );
  await assert.rejects(fs.stat(path.join(root, "prettier.config.js")), { code: "ENOENT" });
  const repeated = await run(planProject(root, resolved, options));
  assert.ok(repeated.files.every((file) => file.kind === "noop"));
  const base = await run(
    resolveInputs(await run(loadPolicy(referencePolicy, { integrations: [], automation: [] })), {}),
  );
  const cleanup = await run(
    planProject(root, base, {
      ...options,
      previous: resolved.intent,
      currentBundles: loaded.bundles,
    }),
  );
  assert.equal(cleanup.requiresConfirmation, true);
  await run(applyPlan(cleanup, { approved: true, dependencies: noInstall }));
  assert.equal(await fs.readFile(path.join(root, ".husky/pre-commit"), "utf8"), "echo unrelated\n");
  assert.equal(
    await fs.readFile(path.join(root, ".github/workflows/app.yml"), "utf8"),
    "name: untouched\n",
  );
  await assert.rejects(fs.stat(path.join(root, ".github/workflows/its-checks.yml")), {
    code: "ENOENT",
  });
  const after = parseManifest(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(after.devDependencies.tailwindcss, undefined);
  assert.equal(after.scripts.postinstall, undefined);
  assert.ok(after.devDependencies.oxfmt !== undefined);
});

await test("native baseline/integration/declarations edits and a new directory reach output without installer changes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-policy-author-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const policy = path.join(root, "policy"),
    target = path.join(root, "project");
  await fs.cp(referencePolicy, policy, { recursive: true });
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "package.json"), '{"name":"author-example"}\n');
  const setup = async (integrations = ["tailwind"]) => {
    const resolved = await run(
      resolveInputs(
        await run(loadPolicy(policy, { integrations, automation: ["husky", "github-actions"] })),
        answers,
      ),
    );
    const previous = await run(loadPreviousIntent(target));
    const plan = await run(
      planProject(target, resolved, {
        scripts: createScriptPlanner("npm"),
        ...(previous !== undefined ? { previous } : {}),
      }),
    );
    await run(applyPlan(plan, { approved: true, dependencies: noInstall }));
    return plan;
  };
  await setup();
  const modify = async (file: string, edit: (value: ReturnType<typeof json>) => object) => {
    const full = path.join(policy, file);
    const value = json(await fs.readFile(full, "utf8"));
    await fs.writeFile(full, JSON.stringify(edit(value)));
  };
  await modify("typescript/base/files/.oxfmtrc.json", (v) => ({ ...v, semi: false }));
  await modify("typescript/base/bundle.json", (v) => ({
    ...v,
    scripts: { ...strings(v.scripts), lint: "oxlint --deny-warnings src" },
    devDependencies: { ...strings(v.devDependencies), oxlint: "1.89.0" },
  }));
  await modify("typescript/integrations/tailwind/files/.oxlintrc.json", (v) => ({
    ...v,
    rules: { ...object(v.rules), "tailwindcss/no-arbitrary-value": "error" },
  }));
  await fs.writeFile(
    path.join(policy, "typescript/automation/husky/files/.husky/its-checks-pre-commit"),
    "# its-checks: managed\nnode --run lint\n",
  );
  const workflow = path.join(
    policy,
    "typescript/automation/github-actions/files/.github/workflows/its-checks.yml",
  );
  await fs.writeFile(
    workflow,
    (await fs.readFile(workflow, "utf8")).replace(
      "- run: node --run check",
      "- run: node --run lint",
    ),
  );
  const existingIntegrations = (await run(discoverPolicy(policy))).integrations.map(
    (entry) => entry.id,
  );
  const directory = path.join(policy, "typescript/integrations/strict/files");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(path.dirname(directory), "bundle.json"),
    '{"name":"Strict","scripts":{"check":"echo strict"}}',
  );
  await fs.writeFile(path.join(directory, ".oxlintrc.json"), '{"rules":{"eqeqeq":"error"}}');
  assert.deepEqual(
    (await run(discoverPolicy(policy))).integrations.map((entry) => entry.id),
    [...existingIntegrations, "strict"].toSorted(),
  );
  assert.equal((await setup(["tailwind", "strict"])).requiresConfirmation, true);
  const read = async (file: string) => await fs.readFile(path.join(target, file), "utf8");
  assert.equal(json(await read(".oxfmtrc.json")).semi, false);
  assert.equal(
    object(json(await read(".oxlintrc.json")).rules)["tailwindcss/no-arbitrary-value"],
    "error",
  );
  assert.equal(object(json(await read(".oxlintrc.json")).rules).eqeqeq, "error");
  const manifest = parseManifest(await read("package.json"));
  assert.equal(manifest.devDependencies.oxlint, "1.89.0");
  assert.match(defined(manifest.scripts["its-checks:lint"]), /--deny-warnings src/);
  assert.match(defined(manifest.scripts["its-checks:check"]), /echo strict/);
  assert.match(await read(".husky/its-checks-pre-commit"), /node --run lint/);
  assert.match(await read(".github/workflows/its-checks.yml"), /- run: node --run lint/);
  assert.ok((await setup(["strict", "tailwind"])).files.every((file) => file.kind === "noop"));
});
