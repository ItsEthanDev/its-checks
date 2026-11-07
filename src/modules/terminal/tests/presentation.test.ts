import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";

const exec = promisify(execFile);
const render = async (scenario: string, color = false): Promise<string> => {
  const result = await exec(
    "node",
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./presentation.probe.ts", import.meta.url)),
      scenario,
    ],
    { env: { ...process.env, NO_COLOR: color ? undefined : "1", FORCE_COLOR: color ? "1" : "0" } },
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

await test("completion ends with titled bundle boxes and renders emphasis with and without color", async () => {
  const plain = await render("preview");
  assert.ok(plain.indexOf("Completed:") < plain.indexOf("Fixture tools"));
  assert.ok(plain.indexOf("Fixture tools") < plain.indexOf("Other tools"));
  assert.match(plain, /Fixture tools ─+╮/);
  assert.match(plain, /MIGRATION NOTE/);
  assert.match(plain, /Read docs\/guide.md\./);
  assert.match(plain, /Keep this second line\./);
  assert.doesNotMatch(plain, /\*\*/);
  assert.equal(stripVTControlCharacters(plain), plain);
  const colored = await render("preview", true);
  assert.ok(colored.includes("\u001b[1m"));
  assert.ok(colored.includes("\u001b[36m"));
  assert.match(stripVTControlCharacters(colored), /MIGRATION NOTE/);
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
