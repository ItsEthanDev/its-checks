import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { Effect, Schema } from "effect";

import { json, object, manifest as parseManifest } from "../../../../test/shared/assertions.ts";
import { planProject, type ChangePlan, type PackageManager } from "../../planning/index.ts";
import {
  loadPolicy,
  resolveInputs,
  loadPreviousIntent,
  type LoadedBundle,
} from "../../policy/index.ts";
import { nodeManagerOperations } from "../adapters.ts";
import {
  applyPlan,
  ApplicationError,
  createDependencyAdapter,
  resolveTargetManager,
  type ApplicationDependencies,
} from "../index.ts";
const run = Effect.runPromise;
const empty = ["base"];
// Authored local lifecycle commands only. Dependencies are local archives without hooks or bin entries.
const lifecycle = `node -e 'const f=require("node:fs"); if(!f.existsSync(".oxlintrc.json"))process.exit(81); f.appendFileSync("lifecycle.log","postinstall\\n"); if(f.existsSync("fail-lifecycle"))process.exit(42)'`;
const original = `node -e 'require("node:fs").appendFileSync("commands.log","original\\n")'`;
const helper = `node -e 'require("node:fs").appendFileSync("commands.log","helper\\n")'`;
const put = async (file: string, value: string | object) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
  );
};
const declaration = (archive: string | null) => ({
  name: "Base",
  description: "Local tooling fixture",
  files: [
    {
      source: "files/.oxlintrc.json",
      target: ".oxlintrc.json",
      operation: "replace",
      format: "json",
    },
  ],
  scripts: { check: helper },
  ...(archive !== null ? { devDependencies: { "managed-dep": `file:../${archive}.tgz` } } : {}),
});
for (const manager of ["npm", "pnpm", "yarn", "bun"] as PackageManager[]) {
  await test(
    `${manager}: real install/update/remove/rerun/failure/retry/lifecycle/wrappers`,
    { timeout: 120000 },
    async (t) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `its-checks-real-${manager}-`));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const project = path.join(root, "project"),
        policy = path.join(root, "policy");
      for (const [name, version, archive] of [
        ["managed-dep", "1.0.0", "one"],
        ["managed-dep", "2.0.0", "two"],
        ["unrelated-dep", "1.0.0", "keep"],
      ] as const) {
        const dir = path.join(root, archive, "package");
        await put(path.join(dir, "package.json"), { name, version });
        const tar = await run(
          nodeManagerOperations.run(
            "tar",
            ["-czf", path.join(root, `${archive}.tgz`), "-C", path.dirname(dir), "package"],
            root,
          ),
        );
        assert.equal(tar.code, 0, tar.stderr);
      }
      // No packageManager version declaration or required linker setting.
      await put(path.join(project, "package.json"), {
        name: "real-project",
        private: true,
        scripts: { postinstall: lifecycle, check: original },
        devDependencies: { "unrelated-dep": "file:../keep.tgz" },
        custom: { preserved: true },
      });
      await isolateManager(project, manager);
      await put(path.join(policy, "base/bundle.json"), declaration("one"));
      await put(path.join(policy, "base/files/.oxlintrc.json"), {
        rules: { "no-debugger": "error" },
      });
      const resolution = await run(resolveTargetManager(project, manager));
      if (resolution.kind !== "resolved") {
        throw Error("Expected manager");
      }
      let installs = 0;
      const adapter = createDependencyAdapter(resolution.target, {
        run: (cmd, args, cwd) => {
          assert.deepEqual([cmd, args, cwd], [manager, ["install"], project]);
          installs++;
          return nodeManagerOperations.run(cmd, args, cwd);
        },
      });
      let prior: readonly LoadedBundle[] = [];
      let pending: readonly LoadedBundle[] = [];
      const plan = async () => {
        const previous = await run(loadPreviousIntent(project));
        const loaded = await run(
          loadPolicy(policy, empty, { repository: "example/fork", commit: "a".repeat(40) }),
        );
        pending = loaded.bundles;
        return await run(
          planProject(project, await run(resolveInputs(loaded, {})), {
            manager: resolution.target.manager,
            ...(previous !== undefined ? { previous } : {}),
            previousBundles: prior,
          }),
        );
      };
      const apply = async () => {
        const report = await run(
          applyPlan(await plan(), { approved: true, dependencies: adapter }),
        );
        prior = pending;
        return report;
      };
      const version = async (name = "managed-dep") =>
        json(await fs.readFile(path.join(project, "node_modules", name, "package.json"), "utf8"))
          .version;
      assert.equal(installs, 0);
      assert.equal((await apply()).dependencyWork, "completed");
      assert.equal(await version(), "1.0.0");
      assert.equal(await version("unrelated-dep"), "1.0.0");
      const check = await run(nodeManagerOperations.run(manager, ["run", "check"], project));
      assert.equal(check.code, 0, check.stderr);
      assert.equal(
        await fs.readFile(path.join(project, "commands.log"), "utf8"),
        "original\nhelper\n",
      );
      await checkMatchingReruns(project, plan, adapter);
      assert.equal(installs, 3);
      // Managers may cache lifecycle execution on unchanged installs (pnpm does).
      assert.match(
        await fs.readFile(path.join(project, "lifecycle.log"), "utf8"),
        /^postinstall\n/,
      );
      await put(path.join(policy, "base/bundle.json"), declaration("two"));
      await apply();
      assert.equal(await version(), "2.0.0");
      await put(path.join(project, "fail-lifecycle"), "");
      const manifestFile = path.join(project, "package.json");
      const beforeFailure = json(await fs.readFile(manifestFile, "utf8"));
      // pnpm may skip root hooks on unchanged installs. Use an unresolvable local input
      // to test its failure path without overriding native caching or lifecycle policy.
      if (manager === "pnpm") {
        await put(manifestFile, {
          ...beforeFailure,
          devDependencies: {
            ...object(beforeFailure.devDependencies),
            "missing-dep": "file:../missing.tgz",
          },
        });
      }
      await put(path.join(policy, "base/files/.oxlintrc.json"), {
        rules: { "no-debugger": "warn" },
      });
      const failed = await run(
        applyPlan(await plan(), { approved: true, dependencies: adapter }).pipe(
          Effect.match({
            onSuccess: () => {
              throw Error("Expected installation failure");
            },
            onFailure: (error) => error,
          }),
        ),
      );
      assert.ok(Schema.is(ApplicationError)(failed));
      assert.equal(failed.phase, "dependencies");
      assert.match(failed.message, manager === "pnpm" ? /missing\.tgz/ : /42|postinstall/);
      assert.ok(failed.message.includes(`rerun ${manager} install`));
      assert.ok((await fs.readFile(path.join(project, ".its-checks.json"), "utf8")).length > 0);
      assert.equal(
        object(json(await fs.readFile(path.join(project, ".oxlintrc.json"), "utf8")).rules)[
          "no-debugger"
        ],
        "warn",
      );
      await fs.unlink(path.join(project, "fail-lifecycle"));
      if (manager === "pnpm") {
        await put(manifestFile, beforeFailure);
      }
      assert.equal((await apply()).dependencyWork, "completed");
      await put(path.join(policy, "base/bundle.json"), declaration(null));
      await apply();
      const removed = parseManifest(await fs.readFile(path.join(project, "package.json"), "utf8"));
      assert.equal(removed.devDependencies["managed-dep"], undefined);
      assert.equal(await version("unrelated-dep"), "1.0.0");
      // The package manager decides whether removed packages remain incidentally installed.
      // Changed lifecycle helpers behind stable wrappers must be handed to the normal install too.
      let wrapper: string | undefined;
      for (const value of ["first", "second"]) {
        await put(path.join(policy, "base/bundle.json"), {
          ...declaration(null),
          scripts: {
            check: helper,
            prepare: `node -e 'require("node:fs").appendFileSync("prepare.log","${value}\\n")'`,
          },
        });
        await apply();
        const current = parseManifest(await fs.readFile(path.join(project, "package.json"), "utf8"))
          .scripts.prepare;
        if (wrapper !== undefined) {
          assert.equal(current, wrapper);
        }
        wrapper = current;
      }
      if (manager !== "pnpm") {
        assert.equal(
          await fs.readFile(path.join(project, "prepare.log"), "utf8"),
          "first\nsecond\n",
        );
      }
      const final = parseManifest(await fs.readFile(path.join(project, "package.json"), "utf8"));
      assert.deepEqual(final.custom, { preserved: true });
      assert.equal(final.scripts.postinstall, lifecycle);
      assert.equal(final.devDependencies["unrelated-dep"], "file:../keep.tgz");
      assert.equal(installs, 9);
    },
  );
}
async function isolateManager(project: string, manager: PackageManager) {
  // Keep integration fixtures offline; these are test isolation settings, not product requirements.
  if (manager === "npm") {
    await put(path.join(project, ".npmrc"), "offline=true\naudit=false\nfund=false\n");
  }
  if (manager === "yarn") {
    await put(path.join(project, ".yarnrc"), "disable-self-update-check true\noffline true\n");
  }
}
async function checkMatchingReruns(
  project: string,
  plan: () => Promise<ChangePlan>,
  adapter: ApplicationDependencies,
) {
  // A matching or reformatted configuration still delegates installation; no native-state audit.
  for (const layout of ["whitespace", "key-order"]) {
    const file = path.join(project, "package.json");
    const manifest = json(await fs.readFile(file, "utf8"));
    const bytes =
      layout === "whitespace"
        ? `${JSON.stringify(manifest, null, 4)}\n\n`
        : `${JSON.stringify(Object.fromEntries(Object.entries(manifest).toReversed()))}\n`;
    await fs.writeFile(file, bytes);
    const matching = await plan();
    assert.ok(matching.files.every((entry) => entry.kind === "noop"));
    assert.equal(
      (await run(applyPlan(matching, { approved: true, dependencies: adapter }))).dependencyWork,
      "completed",
    );
    assert.equal(await fs.readFile(file, "utf8"), bytes);
  }
}
