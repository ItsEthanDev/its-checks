import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Effect } from "effect";
import { loadPolicy } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import { planProject } from "../src/planning.ts";
import { applyPlan } from "../src/application.ts";
import { createScriptPlanner } from "../src/scripts.ts";

// Live policy behavior, separate from the CLI's fixed reference-policy tests.
test("Tailwind and Convex policies compose with the base and enforce their contracts", { timeout: 180_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-integration-policy-"));
  t.after(() => process.env.ITS_CHECKS_KEEP_FIXTURES ? console.error(`Fixture: ${root}`) : fs.rm(root, { recursive: true, force: true }));
  const command = (name: string, args: string[]) => {
    const result = spawnSync(name, args, { cwd: root, encoding: "utf8", timeout: 120_000 });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return { code: result.status, output: result.stdout + result.stderr };
  };
  const good = (name: string, args: string[]) => {
    const result = command(name, args);
    assert.equal(result.code, 0, result.output);
    return result.output;
  };
  await fs.cp(path.resolve("test/fixtures/integration-policy"), root, { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "integration-policy-fixture", private: true, type: "module",
    // Test-owned runtime pin; no remote Convex deployment or code generation.
    devDependencies: { convex: "1.48.0" },
  }));
  const loaded = await Effect.runPromise(loadPolicy(path.resolve("policy"), {
    integrations: ["tailwind", "convex"], automation: [],
  }));
  const resolved = await Effect.runPromise(resolveInputs(loaded, {
    "integrations/tailwind": { "formatter-stylesheet": "src/styles.css", "linter-stylesheet": "src/styles.css" },
  }));
  const plan = await Effect.runPromise(planProject(root, resolved, { scripts: createScriptPlanner("npm") }));
  const applied = await Effect.runPromise(applyPlan(plan, { approved: true, dependencies: {
    assess: () => Effect.succeed("not-required" as const),
    install: () => Effect.die("Installation must use --ignore-scripts below"),
  } }));
  assert.equal(applied.status, "completed");
  good("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  const lint = path.join(root, "node_modules/.bin/oxlint");
  const format = path.join(root, "node_modules/.bin/oxfmt");

  const result = command(lint, ["--format", "json", "violations"]);
  assert.equal(result.code, 1, result.output);
  const report = JSON.parse(result.output) as { diagnostics: { filename: string; code: string; severity: string }[] };
  for (const [file, rule, count] of [
    ["classes.ts", "tailwindcss(enforces-canonical-classname)", 1],
    ["classes.ts", "tailwindcss(enforces-shorthand)", 2],
    ["classes.ts", "tailwindcss(no-custom-classname)", 1],
    ["functions.ts", "@convex-dev(require-access-control)", 2],
    ["functions.ts", "@convex-dev(no-collect-in-query)", 1],
    ["functions.ts", "@convex-dev(no-filter-in-query)", 1],
    ["crons.ts", "@convex-dev(no-top-of-hour-crons)", 1],
  ] as const) {
    const diagnostics = report.diagnostics.filter((diagnostic) =>
      path.basename(diagnostic.filename) === file && diagnostic.code === rule);
    assert.equal(diagnostics.length, count, `Expected ${count} ${rule} in ${file}:\n${result.output}`);
    assert.ok(diagnostics.every((diagnostic) => diagnostic.severity === "error"), result.output);
  }

  // Valid indexed, bounded, authenticated and internal queries; Node-to-Node imports.
  good(lint, ["valid"]);
  // Pinned Oxlint applies overlapping JS-plugin fixes one pass at a time.
  // Suffix, canonical spelling and shorthand each rewrite the whole literal.
  for (let pass = 0; pass < 3; pass++) {
    const repair = command(lint, ["--fix", "fixable"]);
    assert.ok(repair.code === 0 || repair.code === 1, repair.output);
  }
  good(lint, ["fixable"]);
  good(format, ["fixable", "valid"]);
  const fixed = await fs.readFile(path.join(root, "fixable/classes.ts"), "utf8");
  for (const classname of ["font-bold!", "size-4", "text-brand"]) assert.ok(fixed.includes(classname), fixed);
  const helpers = await fs.readFile(path.join(root, "valid/helpers.ts"), "utf8");
  assert.equal(helpers.match(/"flex p-4"/g)?.length, 10, "Every supported helper sorts its classes");
  good(lint, ["--fix", "fixable", "valid"]);
  good(format, ["fixable", "valid"]);
  assert.equal(await fs.readFile(path.join(root, "fixable/classes.ts"), "utf8"), fixed, "Fix/format must converge");
  assert.equal(await fs.readFile(path.join(root, "valid/helpers.ts"), "utf8"), helpers);
  good(format, ["--check", "fixable", "valid"]);
  good(lint, ["fixable", "valid"]);
});
