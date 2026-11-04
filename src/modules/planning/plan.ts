import type { LoadedBundle } from "../policy/index.ts";

/** Target-manager choice determines generated script invocations. */
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Exact bytes and permission bits, not a decoded/reformatted approximation. */
export type FileState =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly base64: string; readonly mode: number };
export interface TargetSnapshot {
  readonly root: string;
  readonly files: Readonly<Record<string, FileState>>;
}
export type ChangeKind = "creation" | "addition" | "replacement" | "removal" | "noop";
export interface EntryChange {
  readonly section: "dependencies" | "devDependencies" | "scripts";
  readonly name: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly kind: ChangeKind;
  readonly conflict: boolean;
}
export interface FileChange {
  readonly path: string;
  readonly before: FileState;
  readonly after: FileState;
  readonly kind: ChangeKind;
  readonly conflict: boolean;
  readonly reasons: readonly string[];
}
export interface DeferredChange {
  readonly path: string;
  readonly reason: string;
}
/** The approval artifact shared by planning, presentation, persistence, and application. */
export interface ChangePlan {
  readonly sources?: readonly { readonly repository: string; readonly commit: string }[];
  readonly bundles?: readonly {
    readonly key: string;
    readonly explicit: boolean;
    readonly requiredBy: readonly string[];
  }[];
  readonly snapshot: TargetSnapshot;
  readonly files: readonly FileChange[];
  readonly packageEntries: readonly EntryChange[];
  readonly requiresConfirmation: boolean;
  /** Application accepts only complete plans. */
  readonly complete: boolean;
  readonly deferred: readonly DeferredChange[];
}
export interface PlanOptions {
  readonly manager: PackageManager;
  /** Previous pinned, input-bound declarations identify cleanup, including changed retained bundles. */
  readonly previousBundles?: readonly LoadedBundle[];
}
