export { planProject } from "./lib/planning.ts";
export { PlanError } from "./lib/plan-errors.ts";
export { assertTargetUnchanged, readTargetSnapshot } from "./lib/target-snapshot.ts";
export type {
  ChangeKind,
  EntryChange,
  FileChange,
  DeferredChange,
  ChangePlan,
  PlanOptions,
  FileState,
  TargetSnapshot,
  PackageManager,
} from "./plan.ts";
