import type { LoadedBundle, SavedIntent } from "../policy/index.ts";

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
  readonly snapshot: TargetSnapshot;
  readonly files: readonly FileChange[];
  readonly packageEntries: readonly EntryChange[];
  readonly requiresConfirmation: boolean;
  /** Retained for saved-plan compatibility; new plans are always complete. */
  readonly complete: boolean;
  readonly deferred: readonly DeferredChange[];
}
export interface PlanOptions {
  readonly manager: PackageManager;
  readonly previous?: SavedIntent;
  /** Current declarations identify deselection; historical bundles are never reconstructed. */
  readonly currentBundles?: readonly LoadedBundle[];
}
