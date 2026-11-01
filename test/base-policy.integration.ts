import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Policy product seam: the shipped native configs consumed by the pinned Oxc tools.
// The CLI's fixed reference-policy fixtures deliberately remain independent.
test("base policy rejects weak patterns and accepts explicit, typed alternatives", { timeout: 180_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-base-policy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
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
  const base = path.resolve("policy/typescript/base");
  const declaration = JSON.parse(await fs.readFile(path.join(base, "bundle.json"), "utf8"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "base-policy-fixture", private: true, type: "module", devDependencies: declaration.devDependencies,
  }));
  // Only public tool packages; never execute dependency lifecycle scripts.
  good("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  await fs.cp(path.join(base, "files"), root, { recursive: true });
  await fs.cp(path.resolve("test/fixtures/base-policy"), root, { recursive: true });
  const lint = path.join(root, "node_modules/.bin/oxlint");
  const format = path.join(root, "node_modules/.bin/oxfmt");

  const result = command(lint, ["--format", "json", "violations"]);
  assert.equal(result.code, 1, result.output);
  const report = JSON.parse(result.output) as { diagnostics: {
    filename: string; code?: string; severity: string; message: string;
    labels: { span: { line: number } }[];
  }[] };
  const expected = JSON.parse(await fs.readFile(path.join(root, "expected-diagnostics.json"), "utf8")) as Record<string, string[]>;
  for (const [file, rules] of Object.entries(expected)) {
    for (const rule of rules) {
      assert.ok(report.diagnostics.some((diagnostic) =>
        path.basename(diagnostic.filename) === file && diagnostic.code === rule && diagnostic.severity === "error"),
      `Missing ${rule} in ${file}:\n${result.output}`);
    }
  }
  // Check each non-default condition and Promise option, not just rule activation.
  for (const [file, rule, lines] of [
    ["conditions.ts", "typescript(strict-boolean-expressions)", [2, 5, 8]],
    ["conditions.ts", "typescript(switch-exhaustiveness-check)", [14, 21]],
    ["async.ts", "typescript(no-floating-promises)", [4, 6]],
  ] as const) {
    for (const line of lines) {
      assert.ok(report.diagnostics.some((diagnostic) => path.basename(diagnostic.filename) === file &&
        diagnostic.code === rule && diagnostic.labels.some((label) => label.span.line === line)),
      `Missing ${rule} at ${file}:${line}`);
    }
  }
  assert.ok(report.diagnostics.some((diagnostic) =>
    path.basename(diagnostic.filename) === "unused-suppression.ts" && diagnostic.severity === "error" &&
    diagnostic.message.startsWith("Unused oxlint-disable directive")), "Stale suppressions must fail lint");

  good(lint, ["valid"]);
  good(format, ["valid"]);
  good(format, ["--check", "valid"]);
  good(lint, ["valid"]);
});
