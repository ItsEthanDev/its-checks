export { applyPlan, ApplicationError } from "./lib/application.ts";
export type {
  ApplicationDependencies,
  ApplicationOptions,
  ApplicationOperation,
  ApplicationReport,
} from "./lib/application.ts";
export {
  createDependencyAdapter,
  resolveTargetManager,
  snapshotManagerEvidence,
} from "./lib/package-managers.ts";
export type { TargetManager, ManagerResolution } from "./lib/package-managers.ts";
export { OperationError } from "./operations.ts";
export type { ApplicationFileSystem, CommandResult, ManagerOperations } from "./operations.ts";
