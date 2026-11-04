import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect } from "effect";

import { safePath } from "../policy/index.ts";
import { PlanError } from "./plan-errors.ts";

/** Exact bytes and permission bits, not a decoded/reformatted approximation. */
export type FileState =
  | { readonly kind: "absent" }
  | {
      readonly kind: "file";
      readonly base64: string;
      readonly mode: number;
    };
export interface TargetSnapshot {
  readonly root: string;
  readonly files: Readonly<Record<string, FileState>>;
}
const error = (source: string, detail: string) => new PlanError({ source, field: "$", detail });
const io = <A>(source: string, operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => error(source, cause instanceof Error ? cause.message : String(cause)),
  });

/** Snapshot only named paths. Refuse symlinks at the root, every traversed parent, and leaf. */
export function readTargetSnapshot(
  projectRoot: string,
  paths: readonly string[],
): Effect.Effect<TargetSnapshot, PlanError> {
  return Effect.gen(function* () {
    const root = path.resolve(projectRoot);
    const rootStat = yield* io(root, () => fs.lstat(root));
    if (!rootStat.isDirectory()) {
      return yield* error(root, "Expected a regular directory, not a symbolic link");
    }
    const files: Record<string, FileState> = {};
    Object.setPrototypeOf(files, null);
    const aliases = new Map<string, string>();
    const sorted = [...new Set(paths)].toSorted();
    for (const relative of sorted) {
      const parent = sorted.find((other) =>
        relative.toLowerCase().startsWith(`${other.toLowerCase()}/`),
      );
      if (parent !== undefined) {
        return yield* error(relative, `Target file path also used as a parent: ${parent}`);
      }
    }
    for (const relative of sorted) {
      if (!safePath(relative)) {
        return yield* error(relative, "Unsafe target-relative path");
      }
      const parts = relative.split("/");
      for (let length = 1; length <= parts.length; length++) {
        const prefix = parts.slice(0, length).join("/");
        const alias = aliases.get(prefix.toLowerCase());
        if (alias !== undefined && alias !== prefix) {
          return yield* error(relative, `Case-alias target path also names ${alias}`);
        }
        aliases.set(prefix.toLowerCase(), prefix);
      }
      files[relative] = yield* readTargetFile(root, parts);
    }
    return { root, files };
  });
}

function readTargetFile(root: string, parts: readonly string[]) {
  return Effect.gen(function* () {
    for (let index = 0; index < parts.length; index++) {
      const source = path.join(root, ...parts.slice(0, index + 1));
      const stat = yield* Effect.tryPromise({
        try: async () => {
          try {
            return await fs.lstat(source);
          } catch (cause) {
            if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
              return undefined;
            }
            throw cause;
          }
        },
        catch: (cause) => error(source, String(cause)),
      });
      if (stat === undefined) {
        return { kind: "absent" as const };
      }
      if (index < parts.length - 1) {
        if (!stat.isDirectory()) {
          return yield* error(source, "Expected a directory; target symlinks are forbidden");
        }
        continue;
      }
      if (!stat.isFile()) {
        return yield* error(source, "Expected a regular file; target symlinks are forbidden");
      }
      return yield* Effect.acquireUseRelease(
        io(source, () => fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW)),
        (handle) =>
          io(source, async () => ({
            kind: "file" as const,
            base64: (await handle.readFile()).toString("base64"),
            mode: (await handle.stat()).mode & 0o777,
          })),
        (handle) => io(source, () => handle.close()),
      );
    }
    return { kind: "absent" as const };
  });
}

/** Application must recheck these observations (including absent alternates) before any write. */
export function assertTargetUnchanged(snapshot: TargetSnapshot): Effect.Effect<void, PlanError> {
  return Effect.gen(function* () {
    const current = yield* readTargetSnapshot(snapshot.root, Object.keys(snapshot.files));
    for (const [relative, before] of Object.entries(snapshot.files)) {
      const after = current.files[relative];
      if (
        after === undefined ||
        before.kind !== after.kind ||
        (before.kind === "file" &&
          after.kind === "file" &&
          (before.base64 !== after.base64 || before.mode !== after.mode))
      ) {
        return yield* error(
          path.join(snapshot.root, relative),
          "Target changed since planning; build and confirm a new plan",
        );
      }
    }
    return undefined;
  });
}
