import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { applyPlan } from "../src/modules/application/index.ts";
import { planProject } from "../src/modules/planning/index.ts";
import { discoverPolicy, loadPolicy, resolveInputs } from "../src/modules/policy/index.ts";
import { defined, objects } from "./shared/assertions.ts";
import { json, object, manifest as parseManifest } from "./shared/assertions.ts";
import { revision } from "./shared/fixtures.ts";
const run = Effect.runPromise;
const reference = path.resolve("test/fixtures/policies/reference");
const all = ["base", "tailwind", "husky", "github-actions"];
const answers = {
  "example/fork:tailwind": {
    "formatter-stylesheet": "src/theme.css",
    "linter-stylesheet": "src/theme.css",
  },
};
const dependencies = {
  assess: () => Effect.succeed("not-required" as const),
  install: () => Effect.die("unexpected install"),
};
await test("fixed reference policy composes, applies, reruns, and cleans up without changing unrelated application data", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-policy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", scripts: { check: "echo original" }, custom: true }),
  );
  await fs.mkdir(path.join(root, ".github/workflows"), { recursive: true });
  await fs.writeFile(path.join(root, ".github/workflows/app.yml"), "name: untouched\n");
  const loaded = await run(loadPolicy(reference, all, revision));
  const resolved = await run(resolveInputs(loaded, answers));
  const initial = await run(planProject(root, resolved, { manager: "npm" }));
  await run(applyPlan(initial, { approved: true, dependencies }));
  const pkg = parseManifest(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.custom, true);
  assert.match(defined(pkg.scripts.check), /echo original/);
  assert.equal(pkg.devDependencies.oxlint, "1.90.0");
  assert.equal(pkg.devDependencies["eslint-plugin-tailwindcss"], "4.4.0");
  const lint = json(await fs.readFile(path.join(root, ".oxlintrc.json"), "utf8"));
  assert.equal(object(lint.rules)["no-debugger"], "error");
  assert.equal(object(object(lint.settings).tailwindcss).cssConfigPath, "src/theme.css");
  const rerun = await run(
    planProject(root, resolved, { manager: "npm", previousBundles: resolved.policy.bundles }),
  );
  assert.ok(rerun.files.every((file) => file.kind === "noop"));
  const base = await run(resolveInputs(await run(loadPolicy(reference, ["base"], revision)), {}));
  await run(
    applyPlan(
      await run(
        planProject(root, base, { manager: "npm", previousBundles: resolved.policy.bundles }),
      ),
      { approved: true, dependencies },
    ),
  );
  await assert.rejects(fs.stat(path.join(root, ".github/workflows/its-checks.yml")), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(path.join(root, ".husky/pre-commit")), { code: "ENOENT" });
  assert.equal(
    await fs.readFile(path.join(root, ".github/workflows/app.yml"), "utf8"),
    "name: untouched\n",
  );
  const after = parseManifest(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(after.devDependencies["eslint-plugin-tailwindcss"], undefined);
  assert.ok(after.devDependencies.oxfmt !== undefined);
  assert.equal(after.scripts.postinstall, undefined);
});
await test("policy authors can add a bundle and edit native declarations without CLI changes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-author-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const policy = path.join(root, "policy");
  await fs.cp(reference, policy, { recursive: true });
  await fs.mkdir(path.join(policy, "strict/files"), { recursive: true });
  const arrays = defined(
    objects(json(await fs.readFile(path.join(policy, "base/bundle.json"), "utf8")).files).find(
      (file) => file.target === ".oxlintrc.json",
    ),
  ).arrays;
  await fs.writeFile(
    path.join(policy, "strict/bundle.json"),
    JSON.stringify({
      name: "Strict",
      description: "Additional rules",
      requires: ["base"],
      scripts: { check: "echo strict" },
      files: [
        {
          source: "files/rules.json",
          target: ".oxlintrc.json",
          operation: "compose",
          format: "json",
          arrays,
        },
      ],
    }),
  );
  await fs.writeFile(path.join(policy, "strict/files/rules.json"), '{"rules":{"eqeqeq":"error"}}');
  assert.ok(
    (await run(discoverPolicy(policy, revision.repository))).bundles.some(
      (bundle) => bundle.id === "strict",
    ),
  );
  const target = path.join(root, "target");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "package.json"), "{}");
  const resolved = await run(
    resolveInputs(await run(loadPolicy(policy, ["strict"], revision)), {}),
  );
  await run(
    applyPlan(await run(planProject(target, resolved, { manager: "npm" })), {
      approved: true,
      dependencies,
    }),
  );
  assert.equal(
    object(json(await fs.readFile(path.join(target, ".oxlintrc.json"), "utf8")).rules).eqeqeq,
    "error",
  );
  assert.match(
    defined(
      parseManifest(await fs.readFile(path.join(target, "package.json"), "utf8")).scripts[
        "its-checks:check"
      ],
    ),
    /echo strict/,
  );
});
