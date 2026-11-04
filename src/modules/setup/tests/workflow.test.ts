import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect, Result, Schema } from "effect";

import { json, object, manifest as parseManifest } from "../../../../test/shared/assertions.ts";
import { fixture, snapshot } from "../../../../test/shared/fixtures.ts";
import {
  ApplicationError,
  OperationError,
  createDependencyAdapter,
  type ApplicationDependencies,
} from "../../application/index.ts";
import { Cancelled, setup, type SetupPresentation } from "../index.ts";
import { dialogue, ready, inputPolicy } from "./workflow-fixtures.ts";

await test("first run asks explicit categories and selected inputs; rerun preselects and prefills without writes or install", async (t) => {
  const f = await fixture(t);
  await inputPolicy(f);
  const first = dialogue({
    integrations: ["example"],
    automation: ["ci"],
    answers: { "integrations/example/stylesheet": "styles/site.css" },
  });
  let installed = 0;
  const dependencies: ApplicationDependencies = {
    assess: () => Effect.succeed("required"),
    install: (plan) => {
      assert.deepEqual(plan, first.plan, "execution must match the displayed plan");
      installed++;
      return Effect.void;
    },
  };
  await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      presentation: first.ui,
      dependencies: () => dependencies,
    }),
  );
  assert.equal(first.managerQuestions, 1);
  assert.equal(first.confirmations, 0);
  assert.equal(installed, 1);
  assert.deepEqual(
    first.shown.map((x) => x.category),
    ["integrations", "automation"],
  );
  assert.equal(first.questions[0]?.initial, "src/app.css");
  assert.equal(
    object(json(await fs.readFile(path.join(f.project, ".oxfmtrc.json"), "utf8")).sortTailwindcss)
      .stylesheet,
    "styles/site.css",
  );
  const before = await snapshot(f.project);
  const stat = await fs.stat(path.join(f.project, ".its-checks.json"));
  const second = dialogue();
  await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      presentation: second.ui,
      dependencies: () => ready,
    }),
  );
  assert.deepEqual(
    second.shown.map((x) => x.previous),
    [["example"], ["ci"]],
  );
  assert.equal(second.questions[0]?.initial, "styles/site.css");
  assert.equal(second.confirmations, 0);
  assert.equal(second.completion?.dependencyWork, "not-required");
  assert.deepEqual(await snapshot(f.project), before);
  assert.equal((await fs.stat(path.join(f.project, ".its-checks.json"))).mtimeMs, stat.mtimeMs);
});

await test("one declined conflict includes current-known deselection and leaves all project state unchanged", async (t) => {
  const f = await fixture(t);
  await inputPolicy(f);
  await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      presentation: dialogue({ integrations: ["example"], automation: ["ci"] }).ui,
      dependencies: () => ready,
    }),
  );
  const before = await snapshot(f.project);
  const d = dialogue({ integrations: [], automation: [], approve: false });
  const result = await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      presentation: d.ui,
      dependencies: () => ready,
    }),
  );
  assert.equal(result.status, "declined");
  assert.equal(d.confirmations, 1);
  assert.ok(d.plan !== undefined);
  assert.ok(
    d.plan.files.some((x) => x.path === ".github/workflows/check.yml" && x.kind === "removal"),
  );
  assert.ok(d.plan.packageEntries.some((x) => x.name === "example" && x.kind === "removal"));
  assert.deepEqual(await snapshot(f.project), before);
});

await test("accepted deselection removes only identifiable current setup and records new intent", async (t) => {
  const f = await fixture(t);
  await inputPolicy(f);
  for (const integrations of [["example"], []]) {
    await Effect.runPromise(
      setup({
        interactive: true,
        projectRoot: f.project,
        policyRoot: f.policy,
        presentation: dialogue({ integrations }).ui,
        dependencies: () => ready,
      }),
    );
  }
  const manifest = parseManifest(await fs.readFile(path.join(f.project, "package.json"), "utf8"));
  assert.equal(manifest.devDependencies.example, undefined);
  assert.equal(manifest.scripts.install, "exit 99");
  assert.deepEqual(
    json(await fs.readFile(path.join(f.project, ".its-checks.json"), "utf8")).integrations,
    [],
  );
});

await test("source identity changes preserve prefills, decline safeguards, and deselection identity", async (t) => {
  const f = await fixture(t);
  await inputPolicy(f);
  await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      commit: "b".repeat(40),
      presentation: dialogue({
        integrations: ["example"],
        automation: ["ci"],
        answers: { "integrations/example/stylesheet": "src/saved.css" },
      }).ui,
      dependencies: () => ready,
    }),
  );
  const file = path.join(f.project, ".its-checks.json");
  const before = await snapshot(f.project),
    declined = dialogue({ approve: false });
  const result = await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      commit: "c".repeat(40),
      presentation: declined.ui,
      dependencies: () => ready,
    }),
  );
  assert.equal(result.status, "declined");
  assert.deepEqual(
    declined.shown.map((category) => category.previous),
    [["example"], ["ci"]],
  );
  assert.equal(declined.questions[0]?.initial, "src/saved.css");
  assert.equal(declined.confirmations, 1);
  assert.deepEqual(
    declined.plan?.files.filter((entry) => entry.kind !== "noop").map((entry) => entry.path),
    [".its-checks.json"],
  );
  assert.deepEqual(await snapshot(f.project), before);
  const accepted = dialogue({ integrations: [], automation: [] });
  await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      commit: "c".repeat(40),
      presentation: accepted.ui,
      dependencies: () => ready,
    }),
  );
  const saved = json(await fs.readFile(file, "utf8"));
  assert.equal(saved.source, "https://github.com/example/fork");
  assert.equal(saved.commit, "c".repeat(40));
  assert.equal(saved.schemaVersion, undefined);
  assert.deepEqual(saved.integrations, []);
  assert.deepEqual(saved.automation, []);
  assert.deepEqual(saved.answers, {});
  assert.equal(
    parseManifest(await fs.readFile(path.join(f.project, "package.json"), "utf8")).devDependencies
      .example,
    undefined,
  );
  await assert.rejects(fs.stat(path.join(f.project, ".github/workflows/check.yml")), {
    code: "ENOENT",
  });
});

await test("retired saved IDs are disclosed, not passed as invalid selections; accepted no-history cleanup remains manual", async (t) => {
  const f = await fixture(t);
  await inputPolicy(f);
  await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      presentation: dialogue({ integrations: ["example"] }).ui,
      dependencies: () => ready,
    }),
  );
  await fs.rm(path.join(f.policy, "typescript/integrations/example"), { recursive: true });
  const d = dialogue();
  await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      presentation: d.ui,
      dependencies: () => ready,
    }),
  );
  assert.deepEqual(d.shown[0]?.previous, []);
  assert.match(d.notes.join("\n"), /Retired saved options: integrations\/example.*manually/);
  const saved = json(await fs.readFile(path.join(f.project, ".its-checks.json"), "utf8"));
  assert.deepEqual(saved.integrations, []);
  assert.deepEqual(saved.answers, {});
  assert.equal(
    parseManifest(await fs.readFile(path.join(f.project, "package.json"), "utf8")).devDependencies
      .example,
    "1.0.0",
  );
});

await test("cancellation during choices, inputs, manager or confirmation is read-only", async (t) => {
  for (const stage of ["choices", "input", "manager", "confirm"] as const) {
    const f = await fixture(t);
    await inputPolicy(f);
    await fs.writeFile(path.join(f.project, ".oxlintrc.json"), '{"rules":{}}');
    const before = await snapshot(f.project);
    const d = dialogue({ integrations: ["example"] });
    const ui = { ...d.ui, [stage]: () => Effect.fail(new Cancelled()) } as SetupPresentation;
    const result = await Effect.runPromise(
      setup({
        interactive: true,
        projectRoot: f.project,
        policyRoot: f.policy,
        presentation: ui,
        dependencies: () => ready,
      }).pipe(Effect.result),
    );
    assert.ok(Result.isFailure(result));
    assert.deepEqual(await snapshot(f.project), before);
  }
});

await test("noninteractive execution fails before any discovery/target reads or questions", async () => {
  const d = dialogue();
  const result = await Effect.runPromise(
    setup({
      interactive: false,
      projectRoot: "/missing-project",
      policyRoot: "/missing-policy",
      presentation: d.ui,
    }).pipe(Effect.result),
  );
  assert.ok(Result.isFailure(result));
  assert.match(String(result.failure), /interactive terminal/);
  assert.deepEqual(d.shown, []);
});

await test("project package-manager settings do not block setup before approval", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project, "package.json"), '{"packageManager":"pnpm@99.0.0"}');
  await fs.writeFile(path.join(f.project, ".oxlintrc.json"), '{"old":true}');
  const before = await snapshot(f.project);
  const d = dialogue({ approve: false });
  const result = await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      presentation: d.ui,
      dependencies: (target) =>
        createDependencyAdapter(target, {
          run: () => Effect.die("Must not invoke a manager before approval"),
        }),
    }),
  );
  assert.equal(result.status, "declined");
  assert.equal(d.confirmations, 1);
  assert.deepEqual(await snapshot(f.project), before);
});

await test("installation failure retains applied intent, reports incomplete work, never emits completion", async (t) => {
  const f = await fixture(t);
  const d = dialogue();
  const dependencies: ApplicationDependencies = {
    assess: () => Effect.succeed("required"),
    install: () =>
      Effect.fail(
        new OperationError({
          detail: "installation failed: inspect lockfile and lifecycle output",
        }),
      ),
  };
  const result = await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      presentation: d.ui,
      dependencies: () => dependencies,
    }).pipe(Effect.result),
  );
  assert.ok(Result.isFailure(result));
  assert.ok(Schema.is(ApplicationError)(result.failure));
  assert.equal(result.failure.report.status, "failed");
  assert.ok(result.failure.report.completed.some((x) => x.path === ".its-checks.json"));
  assert.ok(result.failure.report.incomplete.some((x) => x.kind === "install-dependencies"));
  assert.equal(d.completion, undefined);
  assert.ok((await fs.readFile(path.join(f.project, ".its-checks.json"), "utf8")).length > 0);
});

await test("invalid selected native policy and invalid typed answers fail before any mutation", async (t) => {
  for (const invalid of ["policy", "answer"]) {
    const f = await fixture(t);
    await inputPolicy(f);
    if (invalid === "policy") {
      await f.write("typescript/integrations/example/files/.oxfmtrc.json", "{broken");
    }
    const before = await snapshot(f.project);
    const d = dialogue({
      integrations: ["example"],
      answers: { "integrations/example/stylesheet": 42 },
    });
    const result = await Effect.runPromise(
      setup({
        interactive: true,
        projectRoot: f.project,
        policyRoot: f.policy,
        presentation: d.ui,
        dependencies: () => ready,
      }).pipe(Effect.result),
    );
    assert.ok(Result.isFailure(result));
    assert.match(
      String(result.failure),
      invalid === "policy" ? /\.oxfmtrc\.json/ : /requires path/,
    );
    assert.equal(d.confirmations, 0);
    assert.equal(d.completion, undefined);
    assert.deepEqual(await snapshot(f.project), before);
  }
});

await test("dependency state is reassessed after configuration, not cached from read-only preview", async (t) => {
  const f = await fixture(t);
  const d = dialogue();
  let installed = false;
  const dependencies: ApplicationDependencies = {
    assess: () =>
      Effect.tryPromise({
        try: async () => {
          const intent = await fs.access(path.join(f.project, ".its-checks.json")).then(
            () => true,
            () => false,
          );
          return intent ? ("required" as const) : ("not-required" as const);
        },
        catch: (cause) => new OperationError({ detail: String(cause) }),
      }),
    install: () =>
      Effect.sync(() => {
        installed = true;
      }),
  };
  await Effect.runPromise(
    setup({
      interactive: true,
      projectRoot: f.project,
      policyRoot: f.policy,
      presentation: d.ui,
      dependencies: () => dependencies,
    }),
  );
  assert.equal(installed, true);
  assert.equal(d.completion?.dependencyWork, "completed");
});
