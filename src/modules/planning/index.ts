export { planProject } from "./planning.ts";
export type {
  ChangeKind,
  EntryChange,
  FileChange,
  DeferredChange,
  ChangePlan,
  ScriptContext,
  PlanOptions,
} from "./planning.ts";
export { PlanError } from "./plan-errors.ts";
export { assertTargetUnchanged, readTargetSnapshot } from "./target-snapshot.ts";
export type { FileState, TargetSnapshot } from "./target-snapshot.ts";
export { createScriptPlanner, type PackageManager } from "./scripts.ts";
