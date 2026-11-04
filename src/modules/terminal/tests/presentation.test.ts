import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const render = async (scenario: string): Promise<string> => {
  const result = await exec(
    "node",
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./presentation.probe.ts", import.meta.url)),
      scenario,
    ],
    { env: { ...process.env, NO_COLOR: "1" } },
  );
  return result.stdout + result.stderr;
};

await test("terminal preview identifies conflicts, package changes, lifecycle effects, and completion", async () => {
  const output = await render("preview");
  assert.match(output, /Read-only change plan/);
  assert.match(output, /replacement: config.json \[conflict\]/);
  assert.match(output, /selected configuration/);
  assert.match(output, /scripts.check: "old" → "new"/);
  assert.match(output, /may run lifecycle scripts/);
  assert.match(output, /Completed: 1 file changes; dependencies completed/);
});

await test("terminal failure distinguishes retained partial work from cancellation before application", async () => {
  const failure = await render("failure");
  assert.match(failure, /Install failed/);
  assert.match(failure, /Completed: write-file config.json/);
  assert.match(failure, /Incomplete: install-dependencies package.json/);
  assert.match(failure, /Fix installation and retry/);
  assert.match(failure, /no rollback was performed/);
  assert.doesNotMatch(failure, /No project writes/);
  const cancelled = await render("cancel");
  assert.match(cancelled, /Cancelled before application. No project writes or installation/);
  assert.doesNotMatch(cancelled, /Setup failed/);
});
