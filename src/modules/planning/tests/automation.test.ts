import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { fixture } from "../../../../test/shared/fixtures.ts";
import { resolveInputs } from "../../policy/index.ts";
import { planProject } from "../index.ts";
const run = Effect.runPromise;
for (const operation of ["seed", "replace"] as const) {
  await test(`${operation} applies to documentation, hooks, and workflows without filename inference`, async (t) => {
    const f = await fixture(t);
    const targets = ["docs/module-index.md", ".husky/pre-commit", ".github/workflows/quality.yml"];
    await f.add("automation", {
      name: "Automation",
      requires: [],
      files: targets.map((target, index) => ({
        source: `files/${index}`,
        target,
        operation,
        executable: target.startsWith(".husky/"),
      })),
    });
    await fs.mkdir(path.join(f.policy, "automation/files"));
    for (const [index, target] of targets.entries()) {
      await fs.writeFile(
        path.join(f.policy, `automation/files/${index}`),
        `contribution ${index}\n`,
      );
      await fs.mkdir(path.dirname(path.join(f.project, target)), { recursive: true });
      await fs.writeFile(path.join(f.project, target), "project content\n");
    }
    const resolved = await run(resolveInputs(await f.load(["automation"]), {}));
    const plan = await run(planProject(f.project, resolved, { manager: "npm" }));
    for (const target of targets) {
      assert.equal(
        plan.files.find((file) => file.path === target)?.kind,
        operation === "seed" ? "noop" : "replacement",
      );
    }
  });
}
await test("overlapping seed destinations fail even when the target already exists", async (t) => {
  const f = await fixture(t);
  for (const id of ["one", "two"]) {
    await f.add(id, {
      name: id,
      requires: [],
      files: [{ source: "files/doc", target: "doc.md", operation: "seed" }],
    });
    await fs.mkdir(path.join(f.policy, id, "files"));
    await fs.writeFile(path.join(f.policy, id, "files/doc"), id);
  }
  await fs.writeFile(path.join(f.project, "doc.md"), "existing");
  await assert.rejects(
    run(
      planProject(f.project, await run(resolveInputs(await f.load(["one", "two"]), {})), {
        manager: "npm",
      }),
    ),
    /Different complete-file/,
  );
});
