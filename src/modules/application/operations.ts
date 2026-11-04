import { type Effect, Schema } from "effect";

import type { FileState } from "../planning/plan.ts";

export class OperationError extends Schema.TaggedError<
  OperationError,
  { readonly brand: unique symbol }
>()("OperationError", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}

/** Consequential filesystem seam. Failure must not be reported as success.
 * Saved-intent publication must leave complete old-or-new bytes, never truncated JSON. */
export interface ApplicationFileSystem {
  readonly createDirectory: (absolutePath: string) => Effect.Effect<void, OperationError>;
  readonly writeFile: (
    absolutePath: string,
    state: Extract<FileState, { kind: "file" }>,
    create: boolean,
  ) => Effect.Effect<void, OperationError>;
  readonly removeFile: (absolutePath: string) => Effect.Effect<void, OperationError>;
}
export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}
/** No shell; cwd is always the selected package root. */
export interface ManagerOperations {
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
  ) => Effect.Effect<CommandResult, OperationError>;
}
