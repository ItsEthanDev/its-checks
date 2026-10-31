import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Data, Effect } from "effect";
import type { ChangePlan, FileChange, FileState } from "./planning.ts";
import { assertTargetUnchanged, readTargetSnapshot } from "./target-snapshot.ts";

export class OperationError extends Data.TaggedError("OperationError")<{
  readonly detail: string;
}> { override get message() { return this.detail; } }

/** Consequential external operations. Adapters must fail on incomplete work, not swallow errors. */
export interface ApplicationFileSystem {
  readonly createDirectory: (absolutePath: string) => Effect.Effect<void, OperationError>;
  readonly writeFile: (absolutePath: string, state: Extract<FileState, { kind: "file" }>, create: boolean) => Effect.Effect<void, OperationError>;
  readonly removeFile: (absolutePath: string) => Effect.Effect<void, OperationError>;
}
/** assess is read-only and inspects actual dependency state, even for a matching configuration.
 * install must reconcile the approved manifest, not independently change its requirements. */
export interface ApplicationDependencies {
  readonly assess: (plan: ChangePlan) => Effect.Effect<"required" | "not-required", OperationError>;
  readonly install: (plan: ChangePlan) => Effect.Effect<void, OperationError>;
}
export interface ApplicationOptions {
  readonly approved?: boolean;
  readonly dependencies: ApplicationDependencies;
  readonly fileSystem?: ApplicationFileSystem;
}
export interface ApplicationOperation {
  readonly kind: "create-directory" | "write-file" | "remove-file" | "assess-dependencies" | "install-dependencies";
  readonly path: string;
}
export interface ApplicationReport {
  readonly status: "declined" | "completed" | "failed";
  readonly completed: readonly ApplicationOperation[];
  readonly incomplete: readonly ApplicationOperation[];
  readonly dependencyWork: "not-assessed" | "required" | "not-required" | "completed";
  readonly failed?: ApplicationOperation;
  /** State observed after a failed file operation; unavailable means inspection also failed. */
  readonly observed?: FileState | { readonly kind: "directory"; readonly mode: number } | "unavailable";
  readonly retry?: string;
}
export class ApplicationError extends Data.TaggedError("ApplicationError")<{
  readonly phase: "validation" | "filesystem" | "dependencies";
  readonly detail: string;
  readonly report: ApplicationReport;
}> { override get message() { return `${this.phase}: ${this.detail}`; } }

const io = <A>(operation: () => Promise<A>) => Effect.tryPromise({ try: operation,
  catch: (cause) => new OperationError({ detail: cause instanceof Error ? cause.message : String(cause) }) });

/** No temporary files, backups, directory deletion, lifecycle execution, or rollback. */
export const nodeApplicationFileSystem: ApplicationFileSystem = {
  createDirectory: (destination) => io(async () => { await fs.mkdir(destination); }),
  removeFile: (destination) => io(() => fs.unlink(destination)),
  writeFile: (destination, state, create) => Effect.acquireUseRelease(
    io(() => fs.open(destination, constants.O_WRONLY | constants.O_NOFOLLOW |
      (create ? constants.O_CREAT | constants.O_EXCL : 0), state.mode)),
    (handle) => io(async () => {
      // Truncation, writing, chmod, or close may fail after changing the file. Report observation, not rollback.
      if (!(await handle.stat()).isFile()) throw new Error("Expected a regular file");
      await handle.truncate(0);
      await handle.writeFile(Buffer.from(state.base64, "base64"));
      await handle.chmod(state.mode);
    }),
    (handle) => io(() => handle.close()),
  ),
};
const same = (a: FileState, b: FileState) => a.kind === b.kind &&
  (a.kind === "absent" || (b.kind === "file" && a.base64 === b.base64 && a.mode === b.mode));
const operation = (file: FileChange): ApplicationOperation => ({
  kind: file.after.kind === "absent" ? "remove-file" : "write-file", path: file.path,
});

/** Execute only the complete, explicitly approved plan. Never reload or recompose policy. */
export function applyPlan(plan: ChangePlan, options: ApplicationOptions): Effect.Effect<ApplicationReport, ApplicationError> {
  return Effect.gen(function*() {
    const changes = plan.files.filter((file) => !same(file.before, file.after));
    const assess: ApplicationOperation = { kind: "assess-dependencies", path: "package.json" };
    const install: ApplicationOperation = { kind: "install-dependencies", path: "package.json" };
    const completed: ApplicationOperation[] = [];
    let incomplete = [...changes.map(operation), assess, install];
    let dependencyWork: ApplicationReport["dependencyWork"] = "not-assessed";
    if (options.approved !== true) return { status: "declined", completed, incomplete, dependencyWork };
    const failure = (phase: ApplicationError["phase"], detail: string, failed?: ApplicationOperation,
      observed?: ApplicationReport["observed"]) => new ApplicationError({ phase, detail,
      report: { status: "failed", completed: [...completed],
        incomplete: failed && !incomplete.some((entry) => entry.kind === failed.kind && entry.path === failed.path)
          ? [failed, ...incomplete] : [...incomplete], dependencyWork,
        ...(failed ? { failed } : {}), ...(observed ? { observed } : {}),
        retry: "Inspect the reported partial state, fix the failure, then build and approve a fresh plan. Already applied configuration remains; no rollback was performed. Dependency assessment must inspect actual installation state, not saved intent." } });
    if (!plan.complete) return yield* Effect.fail(failure("validation", "Incomplete plan; finish deferred planning before approval"));
    // A plan is trusted application data, but observations must cover every approved operation.
    for (const file of plan.files) {
      const before = plan.snapshot.files[file.path];
      if (!before || !same(before, file.before)) return yield* Effect.fail(failure("validation", `Missing or inconsistent snapshot: ${file.path}`));
    }
    yield* assertTargetUnchanged(plan.snapshot).pipe(Effect.mapError((cause) => failure("validation", cause.message)));
    const fileSystem = options.fileSystem ?? nodeApplicationFileSystem;
    for (const file of changes) {
      const currentOperation = operation(file);
      const attempt = Effect.gen(function*() {
        // Recheck root, parents, leaf, bytes, and mode immediately before each operation.
        yield* assertTargetUnchanged({ root: plan.snapshot.root, files: { [file.path]: file.before } });
        if (file.after.kind === "file") {
          const parts = file.path.split("/");
          for (let length = 1; length < parts.length; length++) {
            const relative = parts.slice(0, length).join("/");
            const destination = path.join(plan.snapshot.root, relative);
            const stat = yield* io(async () => {
              try { return await fs.lstat(destination); }
              catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw cause; }
            });
            if (stat) {
              if (!stat.isDirectory()) return yield* Effect.fail(new OperationError({ detail: `${relative}: Expected a directory, not a symlink` }));
            } else {
              const mkdir: ApplicationOperation = { kind: "create-directory", path: relative };
              yield* fileSystem.createDirectory(destination).pipe(Effect.mapError((cause) => failure("filesystem", cause.message, mkdir)));
              completed.push(mkdir);
            }
          }
          yield* assertTargetUnchanged({ root: plan.snapshot.root, files: { [file.path]: file.before } });
          yield* fileSystem.writeFile(path.join(plan.snapshot.root, file.path), file.after, file.before.kind === "absent");
        } else yield* fileSystem.removeFile(path.join(plan.snapshot.root, file.path));
        const actual = yield* readTargetSnapshot(plan.snapshot.root, [file.path]);
        if (!same(actual.files[file.path]!, file.after)) return yield* Effect.fail(new OperationError({ detail: `${file.path}: Operation did not produce the approved bytes and mode` }));
      });
      yield* attempt.pipe(Effect.catch((cause) => Effect.gen(function*() {
        const failed = cause instanceof ApplicationError ? cause.report.failed : currentOperation;
        const observed = yield* (failed?.kind === "create-directory"
          ? io(async () => {
            const stat = await fs.lstat(path.join(plan.snapshot.root, failed.path));
            return stat.isDirectory() ? { kind: "directory" as const, mode: stat.mode & 0o777 } : "unavailable" as const;
          }).pipe(Effect.catch(() => Effect.succeed("unavailable" as const)))
          : readTargetSnapshot(plan.snapshot.root, [file.path]).pipe(
            Effect.map((snapshot) => snapshot.files[file.path]!), Effect.catch(() => Effect.succeed("unavailable" as const))));
        if (cause instanceof ApplicationError) return yield* Effect.fail(new ApplicationError({ ...cause,
          report: { ...cause.report, observed } }));
        return yield* Effect.fail(failure("filesystem", cause.message, currentOperation, observed));
      })));
      completed.push(currentOperation);
      incomplete = incomplete.slice(1);
    }
    const required = yield* options.dependencies.assess(plan).pipe(
      Effect.mapError((cause) => failure("dependencies", cause.message, assess)));
    completed.push(assess);
    incomplete = [install];
    dependencyWork = required;
    if (required === "required") {
      yield* options.dependencies.install(plan).pipe(Effect.mapError((cause) => failure("dependencies", cause.message, install)));
      dependencyWork = "completed";
      completed.push(install);
    }
    incomplete = [];
    return { status: "completed", completed, incomplete, dependencyWork };
  });
}
