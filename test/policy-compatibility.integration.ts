import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { Effect } from "effect";

import { applyPlan } from "../src/application.ts";
import type { PolicySelections } from "../src/bundle-types.ts";
import { loadPolicy } from "../src/bundles.ts";
import { resolveInputs } from "../src/inputs.ts";
import {
  createDependencyAdapter,
  resolveTargetManager,
  nodeManagerOperations,
} from "../src/package-managers.ts";
import { planProject } from "../src/planning.ts";
import type { ChangePlan } from "../src/planning.ts";
import { loadPreviousIntent } from "../src/selections.ts";

const run = Effect.runPromise;
const exec = promisify(execFile);
// Fixed toolchain reference, independent of editable policy/.
// Keep these pins and native files test-owned; do not refresh them from live policy.
const referencePolicy = path.resolve("test/fixtures/policies/reference");
const empty = { integrations: [], automation: [] };
const all = { integrations: ["tailwind"], automation: ["husky", "github-actions"] };
const answers = {
  "integrations/tailwind": {
    "formatter-stylesheet": "src/styles.css",
    "linter-stylesheet": "src/styles.css",
  },
};

// Before normal lifecycle execution: resolve the EXACT approved manifest in an isolated
// scripts-disabled audit tree, inspect EVERY installed package's lifecycle declarations,
// then reuse that graph's lock. No remote executable project configuration is fetched.
async function inspectInstall(plan: ChangePlan, audit: string, project: string) {
  await fs.mkdir(audit);
  const manifest = plan.files.find((file) => file.path === "package.json")!.after;
  assert.equal(manifest.kind, "file");
  if (manifest.kind !== "file") {throw Error("Missing planned manifest");}
  await fs.writeFile(path.join(audit, "package.json"), Buffer.from(manifest.base64, "base64"));
  await exec("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: audit });
  const lock = JSON.parse(await fs.readFile(path.join(audit, "package-lock.json"), "utf8"));
  let count = 0;
  for (const location of Object.keys(lock.packages)) {
    if (!location) {continue;}
    let value;
    try {
      value = JSON.parse(await fs.readFile(path.join(audit, location, "package.json"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && lock.packages[location].optional)
        {continue;}
      throw error;
    }
    for (const name of ["preinstall", "install", "postinstall"]) {
      assert.equal(
        value.scripts?.[name],
        undefined,
        `${value.name}@${value.version} now has ${name}: inspect its effects before allowing normal installation`,
      );
    }
    // Registry dependency prepare/prepublish scripts are not installation hooks.
    assert.equal(
      await fs.stat(path.join(audit, location, "binding.gyp")).then(
        () => true,
        () => false,
      ),
      false,
      `${value.name}: implicit node-gyp install requires inspection`,
    );
    count++;
  }
  // Husky 9.1.7 bin/index/husky were inspected: local git config + .husky/_ writes,
  // no init command (which would overwrite package.json/pre-commit), no network.
  // Oxc native binaries are platform optional packages, not install-time downloads.
  await fs.copyFile(path.join(audit, "package-lock.json"), path.join(project, "package-lock.json"));
  return count;
}

test(
  "pinned reference baseline + Tailwind + automation through normal npm adapter, real Oxc and local Husky",
  { timeout: 180_000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "its-policy-compat-"));
    t.after(() =>
      process.env.ITS_CHECKS_KEEP_FIXTURES
        ? console.error(`Fixture: ${root}`)
        : fs.rm(root, { recursive: true, force: true }),
    );
    const project = path.join(root, "project"),
      policy = path.join(root, "policy");
    await fs.cp(referencePolicy, policy, { recursive: true });
    // Fixed policy variation: native package sorting is valid and must converge with setup.
    const formatterPolicy = path.join(policy, "typescript/base/files/.oxfmtrc.json");
    const formatter = JSON.parse(await fs.readFile(formatterPolicy, "utf8"));
    formatter.sortPackageJson = true;
    await fs.writeFile(formatterPolicy, `${JSON.stringify(formatter, null, 2)  }\n`);
    // Fixed migration variation: remove direct ESLint, not the Tailwind plugin's
    // incidental peer installation. This must also no-op when ESLint was never direct.
    const declarationPath = path.join(policy, "typescript/base/bundle.json");
    const declaration = JSON.parse(await fs.readFile(declarationPath, "utf8"));
    declaration.migration.removeDevDependencies.push("eslint");
    await fs.writeFile(declarationPath, `${JSON.stringify(declaration, null, 2)  }\n`);
    await fs.cp(path.resolve("test/fixtures/projects/typescript"), project, { recursive: true });
    // Inspectable original lifecycle: append a local sentinel; preserved ahead of Husky.
    const pkg = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"));
    pkg.scripts = {
      postinstall: `node -e 'require("node:fs").appendFileSync("lifecycle.log","installed\\n")'`,
    };
    await fs.writeFile(path.join(project, "package.json"), `${JSON.stringify(pkg, null, 2)  }\n`);
    await exec("git", ["init", "--quiet"], { cwd: project });
    await fs.mkdir(path.join(project, ".husky"));
    await fs.writeFile(path.join(project, ".husky/pre-commit"), "echo preserved-hook\n");
    const resolution = await run(resolveTargetManager(project));
    assert.equal(resolution.kind, "resolved");
    if (resolution.kind !== "resolved") {throw Error("Expected npm target");}
    let installs = 0;
    const dependencies = createDependencyAdapter(resolution.target, {
      run: (command, args, cwd) => {
        if (args[0] === "install") {installs++;}
        return nodeManagerOperations.run(command, args, cwd);
      },
    });
    const plan = async (selected: PolicySelections = empty) => {
      const previous = await run(loadPreviousIntent(project));
      const loaded = await run(loadPolicy(policy, selected));
      const resolved = await run(
        resolveInputs(loaded, selected.integrations.length ? answers : {}),
      );
      const known = previous ? (await run(loadPolicy(policy, previous))).bundles : [];
      return await run(
        planProject(project, resolved, {
          scripts: resolution.target.scripts,
          ...(previous ? { previous } : {}),
          currentBundles: known,
        }),
      );
    };
    const command = async (name: string, args: string[] = []) => {
      const result = await run(nodeManagerOperations.run(name, args, project));
      return { ...result, output: result.stdout + result.stderr };
    };
    const good = async (name: string, args: string[] = []) => {
      const result = await command(name, args);
      assert.equal(result.code, 0, result.output);
      return result.output;
    };
    const baseline = await plan();
    const baselineAudit = await inspectInstall(baseline, path.join(root, "audit-base"), project);
    assert.equal(
      (await run(applyPlan(baseline, { approved: true, dependencies }))).dependencyWork,
      "completed",
    );
    assert.match(await good("node_modules/.bin/oxfmt", ["--version"]), /0\.75\.0/);
    assert.match(await good("node_modules/.bin/oxlint", ["--version"]), /1\.90\.0/);
    await fs.writeFile(
      path.join(project, "src/bad.ts"),
      "export const bad=()=>{debugger;return 1}\n",
    );
    const formatCheck = await command("npm", ["run", "format:check"]);
    assert.notEqual(formatCheck.code, 0);
    assert.match(formatCheck.output, /src\/bad\.ts/);
    assert.match(
      formatCheck.output,
      /Format issues found in above \d+ files\. Run without `--check` to fix\./,
    );
    assert.match((await command("npm", ["run", "lint"])).output, /no-debugger/);
    await fs.unlink(path.join(project, "src/bad.ts"));
    const beforeFormat = await fs.readFile(path.join(project, "package.json"), "utf8");
    await good("npm", ["run", "format"]);
    const formatted = await fs.readFile(path.join(project, "package.json"), "utf8");
    assert.notEqual(formatted, beforeFormat, "Oxfmt actually changed manifest layout/key order");
    assert.deepEqual(
      JSON.parse(formatted),
      JSON.parse(beforeFormat),
      "formatting preserves manifest values",
    );
    await good("npm", ["run", "lint:fix"]);
    await good("npm", ["run", "check"]);
    for (let cycle = 0; cycle < 2; cycle++) {
      const baseRerun = await plan();
      assert.ok(baseRerun.files.every((file) => file.kind === "noop"));
      assert.equal(
        baseRerun.files.some((file) => file.conflict),
        false,
      );
      assert.equal(
        await run(dependencies.assess(baseRerun)),
        "required",
        "matching configuration still delegates installation",
      );
      const report = await run(applyPlan(baseRerun, { approved: true, dependencies }));
      assert.equal(report.dependencyWork, "completed");
      assert.ok(
        report.completed.every(
          (operation) =>
            operation.kind === "assess-dependencies" || operation.kind === "install-dependencies",
        ),
        "no configuration writes",
      );
      assert.equal(installs, cycle + 2);
      assert.equal(await fs.readFile(path.join(project, "package.json"), "utf8"), formatted);
      await good("npm", ["run", "format"]);
    }

    await fs.cp(path.resolve("test/fixtures/projects/tailwind/src"), path.join(project, "src"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(project, "src/card.tsx"),
      'export const Card=()=> <div className="p-4 flex bg-brand !font-bold block">Hello</div>;\n',
    );
    const combined = await plan(all);
    const combinedAudit = await inspectInstall(
      combined,
      path.join(root, "audit-tailwind"),
      project,
    );
    assert.equal(
      (await run(applyPlan(combined, { approved: true, dependencies }))).dependencyWork,
      "completed",
    );
    assert.equal(installs, 4);
    const installed = async (name: string) =>
      JSON.parse(
        await fs.readFile(path.join(project, "node_modules", name, "package.json"), "utf8"),
      ).version;
    assert.equal(await installed("tailwindcss"), "4.3.3");
    assert.equal(await installed("eslint-plugin-tailwindcss"), "4.4.0");
    assert.equal(await installed("husky"), "9.1.7");
    assert.ok(await installed("eslint"), "Tailwind plugin's peer is installed incidentally");
    const combinedManifest = JSON.parse(
      await fs.readFile(path.join(project, "package.json"), "utf8"),
    );
    assert.equal(combinedManifest.dependencies?.eslint, undefined);
    assert.equal(combinedManifest.devDependencies.eslint, undefined);
    assert.equal(
      (await exec("git", ["config", "core.hooksPath"], { cwd: project })).stdout.trim(),
      ".husky/_",
    );
    assert.equal(
      await fs.readFile(path.join(project, "lifecycle.log"), "utf8"),
      "installed\n".repeat(4),
    );
    const lint = await command("npm", ["run", "lint"]);
    assert.notEqual(lint.code, 0);
    assert.match(lint.output, /no-contradicting-classname/);
    assert.match(lint.output, /important-modifier-suffix/);
    await command("npm", ["run", "lint:fix"]); // Fix suffix, but do not silently choose between contradictory display modes.
    assert.match(await fs.readFile(path.join(project, "src/card.tsx"), "utf8"), /font-bold!/);
    await fs.writeFile(
      path.join(project, "src/card.tsx"),
      'export const Card=()=> <div className="p-4 flex bg-brand font-bold!">Hello</div>;\n',
    );
    await good("npm", ["run", "format"]);
    assert.match(
      await fs.readFile(path.join(project, "src/card.tsx"), "utf8"),
      /className="flex bg-brand p-4 font-bold!"/,
    );
    await good("npm", ["run", "check"]);
    // Execute the actual Husky dispatch locally, not git commit. Empty HOME prevents personal init scripts.
    const home = path.join(root, "home");
    await fs.mkdir(home);
    const hook = await exec("sh", [".husky/_/pre-commit"], {
      cwd: project,
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, HUSKY: "1" },
    });
    assert.match(hook.stdout, /preserved-hook/);
    await fs.writeFile(path.join(project, "src/debug.ts"), "debugger;\n");
    await assert.rejects(
      exec("sh", [".husky/_/pre-commit"], {
        cwd: project,
        env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, HUSKY: "1" },
      }),
    );
    await fs.unlink(path.join(project, "src/debug.ts"));
    const rerun = await plan(all);
    assert.ok(rerun.files.every((file) => file.kind === "noop"));
    assert.equal(
      (await run(applyPlan(rerun, { approved: true, dependencies }))).dependencyWork,
      "completed",
    );
    assert.equal(installs, 5);
    assert.equal(
      (await fs.readFile(path.join(project, ".husky/pre-commit"), "utf8")).match(
        /# BEGIN its-checks/g,
      )?.length,
      1,
    );
    t.diagnostic(
      `Audited ${baselineAudit} baseline and ${combinedAudit} combined installed manifests; 5 normal npm adapter installs; real Oxfmt/Oxlint check/fix + Husky pass/fail; Actions authored/parsed only`,
    );
  },
);
