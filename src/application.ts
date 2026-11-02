import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect, Schema } from "effect";

import type { PlanError } from "./plan-errors.ts";
import type { ChangePlan, FileChange, FileState } from "./planning.ts";
import { selectionFilename } from "./selections.ts";
import { assertTargetUnchanged, readTargetSnapshot } from "./target-snapshot.ts";

export class OperationError extends Schema.TaggedError<
  OperationError,
  { readonly brand: unique symbol }
>()("OperationError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/** Consequential external operations. Adapters must fail on incomplete work, not swallow errors.
 * Selection-file writes must leave complete old-or-new bytes on failure, never truncated intent. */
export interface ApplicationFileSystem {
  readonly createDirectory: (absolutePath: string) => Effect.Effect<void, OperationError>;
  readonly writeFile: (
    absolutePath: string,
    state: Extract<FileState, { kind: "file" }>,
    create: boolean,
  ) => Effect.Effect<void, OperationError>;
  readonly removeFile: (absolutePath: string) => Effect.Effect<void, OperationError>;
}
/** assess is a read-only installation decision, not an audit of the installed tree.
 * install delegates the approved manifest to the package manager without changing its requirements. */
export interface ApplicationDependencies {
  readonly assess: (plan: ChangePlan) => Effect.Effect<"required" | "not-required", OperationError>;
  readonly install: (plan: ChangePlan) => Effect.Effect<void, OperationError>;
}
export interface ApplicationOptions {
  readonly approved?: boolean;
  readonly dependencies: ApplicationDependencies;
  readonly fileSystem?: ApplicationFileSystem;
}
const Operation = Schema.Struct({
  kind: Schema.Literals([
    "create-directory",
    "write-file",
    "remove-file",
    "assess-dependencies",
    "install-dependencies",
  ]),
  path: Schema.String,
});
const Observed = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("absent") }),
  Schema.Struct({ kind: Schema.Literal("file"), base64: Schema.String, mode: Schema.Finite }),
  Schema.Struct({ kind: Schema.Literal("directory"), mode: Schema.Finite }),
  Schema.Literal("unavailable"),
]);
const Report = Schema.Struct({
  status: Schema.Literals(["declined", "completed", "failed"]),
  completed: Schema.Array(Operation),
  incomplete: Schema.Array(Operation),
  dependencyWork: Schema.Literals(["not-assessed", "required", "not-required", "completed"]),
  failed: Schema.optionalKey(Operation),
  /** State observed after a failed file operation; unavailable means inspection also failed. */
  observed: Schema.optionalKey(Observed),
  retry: Schema.optionalKey(Schema.String),
});
export type ApplicationOperation = typeof Operation.Type;
export type ApplicationReport = typeof Report.Type;
export class ApplicationError extends Schema.TaggedError<
  ApplicationError,
  { readonly brand: unique symbol }
>()("ApplicationError", {
  phase: Schema.Literals(["validation", "filesystem", "dependencies"]),
  detail: Schema.String,
  report: Report,
}) {
  override get message(): string {
    return `${this.phase}: ${this.detail}`;
  }
}

const io = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new OperationError({ detail: cause instanceof Error ? cause.message : String(cause) }),
  });

/** No backups, directory deletion, lifecycle execution, or rollback.
 * Selection writes use a transient sibling so failed writes do not truncate retry identity. */
export function createNodeApplicationFileSystem(
  fileSystem: Pick<typeof fs, "mkdir" | "unlink" | "open" | "link" | "rename"> = fs,
): ApplicationFileSystem {
  return {
    createDirectory: (destination) =>
      io(async () => {
        await fileSystem.mkdir(destination);
      }),
    removeFile: (destination) => io(() => fileSystem.unlink(destination)),
    writeFile: (destination, state, create) =>
      path.basename(destination) === selectionFilename
        ? io(async () => {
            const temporary = `${destination}.${randomUUID()}.tmp`;
            const handle = await fileSystem.open(
              temporary,
              constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
              0o600,
            );
            try {
              try {
                await handle.writeFile(Buffer.from(state.base64, "base64"));
                await handle.chmod(state.mode);
              } finally {
                await handle.close();
              }
              // Never expose partial JSON. Exclusive publication also protects an initially absent selection file.
              if (create) {
                await fileSystem.link(temporary, destination);
              } else {
                await fileSystem.rename(temporary, destination);
              }
            } finally {
              await fileSystem.unlink(temporary).catch((cause: unknown) => {
                if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
                  throw cause;
                }
              });
            }
          })
        : Effect.acquireUseRelease(
            io(() =>
              fileSystem.open(
                destination,
                constants.O_WRONLY |
                  constants.O_NOFOLLOW |
                  (create ? constants.O_CREAT | constants.O_EXCL : 0),
                state.mode,
              ),
            ),
            (handle) =>
              io(async () => {
                // Truncation, writing, chmod, or close may fail after changing the file. Report observation, not rollback.
                if (!(await handle.stat()).isFile()) {
                  throw new Error("Expected a regular file");
                }
                await handle.truncate(0);
                await handle.writeFile(Buffer.from(state.base64, "base64"));
                await handle.chmod(state.mode);
              }),
            (handle) => io(() => handle.close()),
          ),
  };
}
export const nodeApplicationFileSystem = createNodeApplicationFileSystem();
const same = (a: FileState, b: FileState) =>
  a.kind === b.kind &&
  (a.kind === "absent" || (b.kind === "file" && a.base64 === b.base64 && a.mode === b.mode));
const operation = (file: FileChange): ApplicationOperation => ({
  kind: file.after.kind === "absent" ? "remove-file" : "write-file",
  path: file.path,
});

/** Execute only the complete, explicitly approved plan. Never reload or recompose policy. */
export function applyPlan(
  plan: ChangePlan,
  options: ApplicationOptions,
): Effect.Effect<ApplicationReport, ApplicationError> {
  return Effect.gen(function* () {
    // Keep the displayed plan intact. Retain prior IDs until every config/cleanup operation succeeds.
    const changed = plan.files.filter((file) => !same(file.before, file.after));
    const changes = [
      ...changed.filter((file) => file.path !== selectionFilename),
      ...changed.filter((file) => file.path === selectionFilename),
    ];
    const assess: ApplicationOperation = { kind: "assess-dependencies", path: "package.json" };
    const install: ApplicationOperation = { kind: "install-dependencies", path: "package.json" };
    const completed: ApplicationOperation[] = [];
    let incomplete = [...changes.map(operation), assess, install];
    let dependencyWork: ApplicationReport["dependencyWork"] = "not-assessed";
    if (options.approved !== true) {
      return { status: "declined", completed, incomplete, dependencyWork };
    }
    const failure = (
      phase: ApplicationError["phase"],
      detail: string,
      failed?: ApplicationOperation,
      observed?: ApplicationReport["observed"],
    ) =>
      new ApplicationError({
        phase,
        detail,
        report: {
          status: "failed",
          completed: [...completed],
          incomplete:
            failed !== undefined &&
            !incomplete.some((entry) => entry.kind === failed.kind && entry.path === failed.path)
              ? [failed, ...incomplete]
              : [...incomplete],
          dependencyWork,
          ...(failed !== undefined ? { failed } : {}),
          ...(observed !== undefined ? { observed } : {}),
          retry:
            "Inspect the reported partial state, fix the failure, then build and approve a fresh plan. Already applied configuration remains; no rollback was performed. Run the selected package manager's install again to retry dependency installation.",
        },
      });
    yield* validatePlan(plan, failure);
    const fileSystem = options.fileSystem ?? nodeApplicationFileSystem;
    for (const file of changes) {
      const currentOperation = operation(file);
      yield* applyFile(file, { root: plan.snapshot.root, fileSystem, completed, failure }).pipe(
        Effect.catch((cause) =>
          reportFileFailure(cause, file, { root: plan.snapshot.root, failure }),
        ),
      );
      completed.push(currentOperation);
      incomplete = incomplete.slice(1);
    }
    const required = yield* options.dependencies
      .assess(plan)
      .pipe(Effect.mapError((cause) => failure("dependencies", cause.message, assess)));
    completed.push(assess);
    incomplete = [install];
    dependencyWork = required;
    if (required === "required") {
      yield* options.dependencies
        .install(plan)
        .pipe(Effect.mapError((cause) => failure("dependencies", cause.message, install)));
      dependencyWork = "completed";
      completed.push(install);
    }
    incomplete = [];
    return { status: "completed", completed, incomplete, dependencyWork };
  });
}

type Failure = (
  phase: ApplicationError["phase"],
  detail: string,
  failed?: ApplicationOperation,
  observed?: ApplicationReport["observed"],
) => ApplicationError;

function validatePlan(plan: ChangePlan, failure: Failure) {
  return Effect.gen(function* () {
    if (!plan.complete) {
      return yield* failure(
        "validation",
        "Incomplete plan; finish deferred planning before approval",
      );
    }
    // A plan is trusted application data, but observations must cover every approved operation.
    for (const file of plan.files) {
      const before = plan.snapshot.files[file.path];
      if (before === undefined || !same(before, file.before)) {
        return yield* failure("validation", `Missing or inconsistent snapshot: ${file.path}`);
      }
    }
    yield* assertTargetUnchanged(plan.snapshot).pipe(
      Effect.mapError((cause) => failure("validation", cause.message)),
    );
    return undefined;
  });
}

type FileApplication = {
  root: string;
  fileSystem: ApplicationFileSystem;
  completed: ApplicationOperation[];
  failure: Failure;
};
function createParents(relativePath: string, context: FileApplication) {
  return Effect.gen(function* () {
    const { root, fileSystem, completed, failure } = context;
    const parts = relativePath.split("/");
    for (let length = 1; length < parts.length; length++) {
      const relative = parts.slice(0, length).join("/");
      const destination = path.join(root, relative);
      const stat = yield* io(async () => {
        try {
          return await fs.lstat(destination);
        } catch (cause) {
          if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
            return undefined;
          }
          throw cause;
        }
      });
      if (stat !== undefined) {
        if (!stat.isDirectory()) {
          return yield* new OperationError({
            detail: `${relative}: Expected a directory, not a symlink`,
          });
        }
        continue;
      }
      const mkdir: ApplicationOperation = { kind: "create-directory", path: relative };
      yield* fileSystem
        .createDirectory(destination)
        .pipe(Effect.mapError((cause) => failure("filesystem", cause.message, mkdir)));
      completed.push(mkdir);
    }
    return undefined;
  });
}

function applyFile(file: FileChange, context: FileApplication) {
  return Effect.gen(function* () {
    const { root, fileSystem } = context;
    const snapshot = { root, files: { [file.path]: file.before } };
    // Recheck root, parents, leaf, bytes, and mode immediately before each operation.
    yield* assertTargetUnchanged(snapshot);
    if (file.after.kind === "file") {
      yield* createParents(file.path, context);
      yield* assertTargetUnchanged(snapshot);
      yield* fileSystem.writeFile(
        path.join(root, file.path),
        file.after,
        file.before.kind === "absent",
      );
    } else {
      yield* fileSystem.removeFile(path.join(root, file.path));
    }
    const actual = yield* readTargetSnapshot(root, [file.path]);
    const observedFile = actual.files[file.path];
    if (observedFile === undefined || !same(observedFile, file.after)) {
      return yield* new OperationError({
        detail: `${file.path}: Operation did not produce the approved bytes and mode`,
      });
    }
    return undefined;
  });
}

function observeFailure(root: string, failed: ApplicationOperation | undefined, file: FileChange) {
  if (failed?.kind === "create-directory") {
    return io(async () => {
      const stat = await fs.lstat(path.join(root, failed.path));
      return stat.isDirectory()
        ? { kind: "directory" as const, mode: stat.mode & 0o777 }
        : ("unavailable" as const);
    }).pipe(Effect.orElseSucceed(() => "unavailable" as const));
  }
  return readTargetSnapshot(root, [file.path]).pipe(
    Effect.map((snapshot) => snapshot.files[file.path] ?? ("unavailable" as const)),
    Effect.orElseSucceed(() => "unavailable" as const),
  );
}

function reportFileFailure(
  cause: OperationError | ApplicationError | PlanError,
  file: FileChange,
  context: Pick<FileApplication, "root" | "failure">,
) {
  return Effect.gen(function* () {
    const failed = Schema.is(ApplicationError)(cause) ? cause.report.failed : operation(file);
    const observed = yield* observeFailure(context.root, failed, file);
    if (Schema.is(ApplicationError)(cause)) {
      return yield* new ApplicationError({
        phase: cause.phase,
        detail: cause.detail,
        report: { ...cause.report, observed },
      });
    }
    return yield* context.failure("filesystem", cause.message, operation(file), observed);
  });
}
