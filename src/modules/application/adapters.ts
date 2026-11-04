import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect } from "effect";

import { selectionFilename } from "../policy/index.ts";
import {
  OperationError,
  type ApplicationFileSystem,
  type CommandResult,
  type ManagerOperations,
} from "./operations.ts";

const io = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new OperationError({ detail: cause instanceof Error ? cause.message : String(cause) }),
  });

/** Native filesystem adapter. Selection writes publish complete bytes atomically.
 * Other failures retain observed effects; this adapter never rolls back or deletes directories. */
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

/** Native subprocess adapter, without a shell or interactive stdin. */
export const nodeManagerOperations: ManagerOperations = {
  run: (command, args, cwd) =>
    io(
      () =>
        new Promise<CommandResult>((resolve, reject) => {
          const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "",
            stderr = "";
          child.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
          });
          child.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });
          child.on("error", reject);
          child.on("close", (code, signal) =>
            resolve({
              code: code ?? 1,
              stdout,
              stderr: stderr + (signal !== null ? `\nTerminated by ${signal}` : ""),
            }),
          );
        }),
    ),
};
