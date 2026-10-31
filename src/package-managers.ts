import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { parseAllDocuments, parse as parseYaml } from "yaml";
import { parse as parseYarnLockfile } from "@yarnpkg/lockfile";
import { parse as parseJsonc } from "jsonc-parser";
import { OperationError, type ApplicationDependencies } from "./application.ts";
import type { ChangePlan } from "./planning.ts";
import { createScriptPlanner, type PackageManager } from "./scripts.ts";

export const testedVersions = { npm: "11.19.0", pnpm: "12.9.0", yarn: "1.22.22", bun: "1.4.0" } as const;
const lockNames: Record<PackageManager, readonly string[]> = {
  npm: ["package-lock.json", "npm-shrinkwrap.json"], pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"], bun: ["bun.lock", "bun.lockb"],
};
export interface TargetManager {
  readonly root: string;
  readonly manager: PackageManager;
  readonly scripts: ReturnType<typeof createScriptPlanner>;
}
export type ManagerResolution = { readonly kind: "resolved"; readonly target: TargetManager } | {
  readonly kind: "question"; readonly reason: string; readonly evidence: readonly string[];
  readonly choices: readonly PackageManager[];
};
const io = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f,
  catch: (cause) => new OperationError({ detail: cause instanceof Error ? cause.message : String(cause) }) });
async function text(root: string, name: string): Promise<string | undefined> {
  try { return await fs.readFile(path.join(root, name), "utf8"); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw cause; }
}
/** Read-only selection. An explicit answer resolves ambiguity; evidence never silently overrides another manager. */
export function resolveTargetManager(root: string, answer?: PackageManager): Effect.Effect<ManagerResolution, OperationError> {
  return io(async () => {
    root = path.resolve(root);
    const manifest = JSON.parse((await text(root, "package.json"))!);
    const evidence: string[] = [];
    const candidates = new Set<PackageManager>();
    let invalid = false;
    if (manifest.packageManager !== undefined) {
      evidence.push(`packageManager: ${String(manifest.packageManager)}`);
      const match = typeof manifest.packageManager === "string" && /^(npm|pnpm|yarn|bun)@.+$/.exec(manifest.packageManager);
      if (match) candidates.add(match[1] as PackageManager); else invalid = true;
    }
    for (const [manager, names] of Object.entries(lockNames)) for (const name of names) {
      if (await text(root, name) !== undefined) { candidates.add(manager as PackageManager); evidence.push(name); }
    }
    const manager = answer ?? (!invalid && candidates.size === 1 ? [...candidates][0] : undefined);
    if (!manager) return { kind: "question", reason: invalid ? "Unsupported or malformed packageManager declaration; choose the target manager."
      : candidates.size ? "Conflicting package-manager evidence; choose the target manager (other lockfiles are preserved)."
        : "No package-manager declaration or lockfile; choose the target manager.", evidence,
      choices: ["npm", "pnpm", "yarn", "bun"] };
    return { kind: "resolved", target: { root, manager, scripts: createScriptPlanner(manager) } };
  });
}

export interface CommandResult { readonly code: number; readonly stdout: string; readonly stderr: string }
/** Consequential process seam. No shell; cwd is always the selected package root. */
export interface ManagerOperations {
  readonly run: (command: string, args: readonly string[], cwd: string) => Effect.Effect<CommandResult, OperationError>;
}
export const nodeManagerOperations: ManagerOperations = {
  run: (command, args, cwd) => io(() => new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code: code ?? 1, stdout,
      stderr: stderr + (signal ? `\nTerminated by ${signal}` : "") }));
  })),
};
type Manifest = Record<string, any>;
const sections = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const entries = (manifest: Manifest): Record<string, string> => Object.assign({}, ...sections.map((s) => manifest[s] ?? {}));
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((k) => Object.hasOwn(y, k) && equal(x[k], y[k]));
};
// Compare commands, not JSON layout or unrelated public scripts. Generated lifecycle
// helpers can change while their public wrapper stays identical. Arbitrary shell
// delegation/configuration cannot be inferred from native installation inventory.
const lifecycleNames = ["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare"];
const lifecycleCommands = (manifest: Manifest) => Object.fromEntries(lifecycleNames.flatMap((name) =>
  [name, `its-checks:${name}`].filter((key) => Object.hasOwn(manifest.scripts ?? {}, key))
    .map((key) => [key, manifest.scripts[key]])));
const installationInputs = (manifest: Manifest) => ({
  ...Object.fromEntries([...sections, "peerDependencies"].map((section) => [section, manifest[section] ?? {}])),
  lifecycle: lifecycleCommands(manifest),
});
function approved(plan: ChangePlan, target: TargetManager): { bytes: string; manifest: Manifest } {
  if (path.resolve(plan.snapshot.root) !== target.root) throw new Error("Target manager belongs to another package root");
  const state = plan.files.find((f) => f.path === "package.json")?.after ?? plan.snapshot.files["package.json"];
  if (!state || state.kind !== "file") throw new Error("Approved package.json is missing");
  const bytes = Buffer.from(state.base64, "base64").toString("utf8");
  return { bytes, manifest: JSON.parse(bytes) };
}
const metadata: Partial<Record<PackageManager, string>> = {
  npm: "node_modules/.package-lock.json", pnpm: "node_modules/.modules.yaml", yarn: "node_modules/.yarn-integrity",
};

/** Normal install, exact approved manifest, actual-state assessment. No saved intent or installer state files. */
export function createDependencyAdapter(target: TargetManager, operations: ManagerOperations = nodeManagerOperations): ApplicationDependencies {
  const { root, manager } = target;
  const command = (args: readonly string[]) => operations.run(manager, args, root);
  const disposable = metadata[manager] ? [metadata[manager]!, ...(manager === "pnpm" ? ["node_modules/.pnpm-workspace-state-v1.json"] : [])] : [];
  const invalidateMetadata = async () => {
    const modules = await fs.lstat(path.join(root, "node_modules")).catch((cause) => { if (cause.code === "ENOENT") return undefined; throw cause; });
    if (modules && !modules.isDirectory()) throw new Error("Refusing native metadata invalidation through non-directory/symlink node_modules");
    for (const name of disposable) {
      const state = await fs.lstat(path.join(root, name)).catch((cause) => { if (cause.code === "ENOENT") return undefined; throw cause; });
      if (state && !state.isFile()) throw new Error(`Refusing to invalidate nonregular native metadata ${name}`);
      if (state) await fs.unlink(path.join(root, name));
    }
  };
  const bunLink = async (name: string): Promise<string | undefined> => {
    const link = path.join(root, "node_modules", name);
    try {
      for (const directory of new Set([path.join(root, "node_modules"), path.dirname(link)])) {
        if (!(await fs.lstat(directory)).isDirectory()) return undefined;
      }
      if (!(await fs.lstat(link)).isSymbolicLink()) return undefined;
      return (await fs.realpath(link)).startsWith(path.join(root, "node_modules/.bun") + path.sep) ? link : undefined;
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw cause; }
  };
  const environment = () => Effect.gen(function*() {
    yield* io(async () => {
      const manifest = JSON.parse((await text(root, "package.json"))!);
      if (manager === "pnpm" && !/^\s*manage-package-manager-versions\s*=\s*false\s*$/m.test(await text(root, ".npmrc") ?? "")) {
        throw new Error("pnpm 12 requires manage-package-manager-versions=false in project .npmrc; assessment must not download/manage a CLI or mutate its lockfile");
      }
      if (typeof manifest.packageManager === "string" && manifest.packageManager.startsWith(`${manager}@`) &&
        manifest.packageManager.split("+")[0] !== `${manager}@${testedVersions[manager]}`) {
        throw new Error(`Unsupported declaration ${manifest.packageManager}; tested ${manager}@${testedVersions[manager]}`);
      }
    });
    const version = yield* command(["--version"]);
    if (version.code !== 0 || version.stdout.trim() !== testedVersions[manager]) return yield* Effect.fail(new OperationError({
      detail: `${manager}: requires tested version ${testedVersions[manager]}; observed ${version.stdout.trim() || version.stderr}` }));
    if (manager !== "bun") {
      const scripts = yield* command(["config", "get", "ignore-scripts"]);
      if (scripts.code !== 0 || scripts.stdout.trim() === "true") return yield* Effect.fail(new OperationError({
        detail: `${manager}: lifecycle scripts must be enabled (config get ignore-scripts: ${scripts.stdout.trim() || scripts.stderr})` }));
    }
    yield* io(async () => {
      if (manager === "yarn") {
        if (await text(root, ".pnp.js") || await text(root, ".pnp.cjs") || /(?:--install\.)?pnp\s+true/.test(await text(root, ".yarnrc") ?? "")) {
          throw new Error("Yarn Classic requires node_modules; PnP is not supported");
        }
      }
      if (manager === "bun") {
        const config = await text(root, "bunfig.toml") ?? "";
        const install = /(?:^|\n)\[install\][ \t]*\n([\s\S]*?)(?=\n\[|$)/.exec(config)?.[1] ?? "";
        if (!/^\s*linker\s*=\s*["']isolated["']\s*$/m.test(install)) {
          throw new Error('Bun requires [install] linker = "isolated" in bunfig.toml; hoisted recovery is not supported');
        }
      }
    });
  });
  async function installedVersion(location: string, version: string): Promise<boolean> {
    const file = await text(root, `${location}/package.json`);
    return file !== undefined && JSON.parse(file).version === version;
  }
  const archiveVersions = (plan: ChangePlan) => Effect.gen(function*() {
    const versions: Record<string, string> = {};
    const desired = yield* io(async () => approved(plan, target));
    if (manager === "bun") for (const [name, spec] of Object.entries(entries(desired.manifest))) {
      if (!spec.startsWith("file:") || !/\.(tgz|tar\.gz)$/.test(spec)) continue;
      const archive = yield* operations.run("tar", ["-xOzf", path.resolve(root, spec.slice(5)), "package/package.json"], root);
      if (archive.code !== 0) return yield* Effect.fail(new OperationError({ detail: `Cannot inspect local archive ${spec}: ${archive.stderr}` }));
      versions[name] = yield* io(async () => JSON.parse(archive.stdout).version);
    }
    return versions;
  });
  async function matching(plan: ChangePlan, versions: Record<string, string>, verifyingInstall = false): Promise<boolean> {
    const desired = approved(plan, target);
    const current = await text(root, "package.json");
    if (current === undefined || !equal(installationInputs(JSON.parse(current)), installationInputs(desired.manifest))) return false;
    const wanted = entries(desired.manifest);
    for (const entry of plan.packageEntries) if (entry.section !== "scripts" && entry.after === null && !Object.hasOwn(wanted, entry.name) && !Object.hasOwn(desired.manifest.peerDependencies ?? {}, entry.name) &&
      await text(root, `node_modules/${entry.name}/package.json`) !== undefined) return false;
    if (!verifyingInstall) {
      const before = plan.snapshot.files["package.json"];
      const prior = before?.kind === "file" ? JSON.parse(Buffer.from(before.base64, "base64").toString("utf8")) : {};
      if (!equal(lifecycleCommands(prior), lifecycleCommands(desired.manifest))) return false;
      if (Object.keys(lifecycleCommands(desired.manifest)).length && plan.files.some((file) =>
        file.path !== "package.json" && file.path !== ".its-checks.json" && !equal(file.before, file.after))) return false;
    }
    const marker = metadata[manager];
    if (marker) {
      const state = await text(root, marker);
      if (state === undefined) return false;
    }
    if (manager === "npm") {
      const raw = await text(root, "npm-shrinkwrap.json") ?? await text(root, "package-lock.json");
      if (!raw) return false;
      const lock = JSON.parse(raw), hidden = JSON.parse((await text(root, metadata.npm!))!);
      if (lock.lockfileVersion !== 3) return false;
      for (const section of sections) if (!equal(lock.packages?.[""]?.[section] ?? {}, desired.manifest[section] ?? {})) return false;
      let installedCount = 0;
      for (const [location, entry] of Object.entries(lock.packages ?? {}) as [string, any][]) {
        if (!location || (entry.optional && !hidden.packages?.[location])) continue;
        installedCount++;
        if (entry.link || !equal(hidden.packages?.[location], entry) || !await installedVersion(location, entry.version)) return false;
      }
      if (Object.keys(hidden.packages ?? {}).length !== installedCount) return false;
      return true;
    }
    if (manager === "pnpm") {
      const raw = await text(root, "pnpm-lock.yaml"), virtual = await text(root, "node_modules/.pnpm/lock.yaml");
      if (!raw || !virtual) return false;
      const documents = parseAllDocuments(raw);
      if (documents.some((doc) => doc.errors.length)) return false;
      const lock = documents.map((doc) => doc.toJSON()).find((doc) => doc.settings && doc.importers);
      if (!lock || !equal(lock, parseYaml(virtual))) return false;
      const importer = lock.importers?.["."] ?? {};
      for (const section of sections) {
        const specs = Object.fromEntries(Object.entries(importer[section] ?? {}).map(([name, value]: [string, any]) => [name, value.specifier]));
        if (!equal(specs, desired.manifest[section] ?? {})) return false;
      }
      for (const [name] of Object.entries(wanted)) {
        const ref = sections.map((s) => importer[s]?.[name]).find(Boolean)?.version;
        const entry = lock.packages?.[`${name}@${ref}`];
        const version = entry?.version ?? (/^\d/.test(ref ?? "") ? ref.split("(")[0] : undefined);
        if (!version || !await installedVersion(`node_modules/${name}`, version)) return false;
      }
      return true;
    }
    if (manager === "yarn") {
      const raw = await text(root, "yarn.lock");
      if (!raw) return false;
      const parsed = parseYarnLockfile(raw);
      if (parsed.type !== "success") return false;
      const lock = parsed.object, state = JSON.parse((await text(root, metadata.yarn!))!);
      const patterns = Object.entries(wanted).map(([name, spec]) => `${name}@${spec}`).sort();
      if (!equal([...(state.topLevelPatterns ?? [])].sort(), patterns)) return false;
      for (const [pattern, resolution] of Object.entries(state.lockfileEntries ?? {})) {
        if (lock[pattern]?.resolved !== resolution) return false;
      }
      for (const [name, spec] of Object.entries(wanted)) {
        const entry = lock[`${name}@${spec}`];
        if (!entry || !await installedVersion(`node_modules/${name}`, entry.version)) return false;
      }
      return true;
    }
    const raw = await text(root, "bun.lock");
    if (!raw) return false;
    const lock = parseJsonc(raw);
    for (const section of sections) if (!equal(lock.workspaces?.[""]?.[section] ?? {}, desired.manifest[section] ?? {})) return false;
    for (const [name, spec] of Object.entries(wanted)) {
      const link = path.join(root, "node_modules", name);
      const stat = await fs.lstat(link).catch(() => undefined);
      if (!stat?.isSymbolicLink()) return false;
      const real = await fs.realpath(link).catch(() => "");
      if (!real.startsWith(path.join(root, "node_modules/.bun") + path.sep)) return false;
      const resolved = lock.packages?.[name]?.[0] as string | undefined;
      if (!resolved) return false;
      if (spec.startsWith("file:") && /\.(tgz|tar\.gz)$/.test(spec)) {
        if (resolved !== `${name}@${spec.slice(5)}` || !await installedVersion(`node_modules/${name}`, versions[name]!)) return false;
        const archive = await fs.readFile(path.resolve(root, spec.slice(5)));
        const integrity = lock.packages[name].find((v: unknown) => typeof v === "string" && v.startsWith("sha512-"));
        if (integrity !== `sha512-${createHash("sha512").update(archive).digest("base64")}`) return false;
        // The real path records Bun's actual resolution, not only the manifest's requested specifier.
        const store = `${name.replaceAll("/", "+")}@${spec.slice(5).replaceAll("/", "+")}`;
        if (path.relative(path.join(root, "node_modules/.bun"), real).split(path.sep)[0] !== store) return false;
      } else {
        const version = resolved.slice(resolved.lastIndexOf("@") + 1);
        if (!/^\d+\.\d+\.\d+/.test(version) || !await installedVersion(`node_modules/${name}`, version)) return false;
      }
    }
    return true;
  }
  const assess: ApplicationDependencies["assess"] = (plan) => Effect.gen(function*() {
    yield* environment();
    // Corrupt/missing native state means work, not successful installation. IO errors still surface.
    const versions = yield* archiveVersions(plan);
    return yield* io(() => matching(plan, versions).catch((cause) => {
      if (cause instanceof SyntaxError || (cause as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw cause;
    })).pipe(Effect.map((matches) => matches ? "not-required" as const : "required" as const));
  });
  return { assess, install: (plan) => Effect.gen(function*() {
    yield* environment();
    const expected = yield* io(async () => {
      const desired = approved(plan, target);
      if (await text(root, "package.json") !== desired.bytes) throw new Error("package.json differs from the exact approved target manifest; replan before installation");
      return desired;
    });
    // Native managers may otherwise trust their cached installation inventory and leave missing links unrepaired.
    if (metadata[manager]) yield* io(invalidateMetadata);
    const result = yield* command(["install"]).pipe(Effect.catch((cause) => Effect.succeed({ code: -1, stdout: "", stderr: cause.message })));
    let problem = result.code === 0 ? undefined : `${manager} install exited ${result.code}: ${result.stderr}\n${result.stdout}`;
    const removedLinks: string[] = [];
    const verification = yield* Effect.gen(function*() {
      const manifest = yield* io(() => text(root, "package.json"));
      if (manifest !== expected.bytes) return "package.json no longer matches approved bytes; inspect and replan";
      if (manager === "bun") {
        // Reconcile approved removals even after failure: a fresh plan loses their identity once intent is saved.
        yield* io(async () => {
          const wanted = entries(expected.manifest);
          for (const entry of plan.packageEntries) if (entry.section !== "scripts" && entry.after === null && !Object.hasOwn(wanted, entry.name) && !Object.hasOwn(expected.manifest.peerDependencies ?? {}, entry.name)) {
            const link = await bunLink(entry.name);
            if (link) {
              await fs.unlink(link);
              removedLinks.push(`node_modules/${entry.name}`);
            }
          }
        });
      }
      if (result.code !== 0) return undefined;
      const versions = yield* archiveVersions(plan);
      const matched = yield* io(() => matching(plan, versions, true));
      return matched ? undefined : `${manager} install returned success but actual installation/lock state does not match the approved manifest\n${result.stdout}\n${result.stderr}`;
    }).pipe(Effect.catch((cause) => Effect.succeed(cause.message)));
    if (verification) problem = problem ? `${problem}\n${verification}` : verification;
    if (problem) {
      const invalidation = yield* io(async () => {
        if (metadata[manager]) {
          await invalidateMetadata();
          return `Invalidated disposable ${disposable.join(", ")}; next assessment requires installation.`;
        }
        for (const name of Object.keys(entries(expected.manifest))) {
          const link = await bunLink(name);
          if (!link) continue;
          await fs.unlink(link);
          return `Unlinked installed direct dependency node_modules/${name} (store target preserved); next assessment requires installation.`;
        }
        throw new Error("Bun recovery BLOCKED: no approved direct dependency symlink into node_modules/.bun to invalidate; retry cannot be guaranteed");
      }).pipe(Effect.catch((cause) => Effect.succeed(`Recovery invalidation failed: ${cause.message}; retry cannot be guaranteed.`)));
      const removals = removedLinks.length ? `\nUnlinked approved removed dependencies ${removedLinks.join(", ")} (store targets preserved).` : "";
      return yield* Effect.fail(new OperationError({ detail: `${problem}${removals}\n${invalidation}\nConfiguration, intent, lockfile changes and lifecycle effects remain; no rollback.` }));
    }
  }) };
}
