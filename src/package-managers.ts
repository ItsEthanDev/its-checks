import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { Effect } from "effect";
import { OperationError, type ApplicationDependencies } from "./application.ts";
import type { ChangePlan } from "./planning.ts";
import { createScriptPlanner, type PackageManager } from "./scripts.ts";

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
function approvedManifest(plan: ChangePlan, target: TargetManager): string {
  if (path.resolve(plan.snapshot.root) !== target.root) throw new Error("Target manager belongs to another package root");
  const state = plan.files.find((f) => f.path === "package.json")?.after ?? plan.snapshot.files["package.json"];
  if (!state || state.kind !== "file") throw new Error("Approved package.json is missing");
  return Buffer.from(state.base64, "base64").toString("utf8");
}

/** The manager owns resolution, lockfiles, installation layout, and repair. */
export function createDependencyAdapter(target: TargetManager, operations: ManagerOperations = nodeManagerOperations): ApplicationDependencies {
  const { root, manager } = target;
  return {
    // An unchanged manifest is not evidence of an installed tree. Always delegate to the manager.
    assess: () => Effect.succeed("required"),
    install: (plan) => Effect.gen(function*() {
      const expected = yield* io(async () => {
        const bytes = approvedManifest(plan, target);
        if (await text(root, "package.json") !== bytes) throw new Error("package.json differs from the exact approved target manifest; replan before installation");
        return bytes;
      });
      const result = yield* operations.run(manager, ["install"], root).pipe(
        Effect.mapError((cause) => new OperationError({ detail: `${manager} install failed: ${cause.message}. Fix the failure and rerun ${manager} install in ${root}. Applied changes remain; no rollback.` })));
      const changed = yield* io(async () => await text(root, "package.json") !== expected);
      const problems = [
        ...(result.code !== 0 ? [`${manager} install exited ${result.code}: ${result.stderr}\n${result.stdout}`] : []),
        ...(changed ? ["package.json no longer matches approved bytes; inspect and replan"] : []),
      ];
      if (problems.length) return yield* Effect.fail(new OperationError({ detail:
        `${problems.join("\n")}\nFix the failure and rerun ${manager} install in ${root}. Configuration, lockfile changes and lifecycle effects remain; no rollback.` }));
    }),
  };
}
