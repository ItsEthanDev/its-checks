export { discoverPolicy, loadPolicy } from "./lib/bundle-loading.ts";
export { BundleError } from "./lib/bundle-errors.ts";
export {
  enumerateInputs,
  resolveInputs,
  type DeclaredInput,
  type ResolvedInputs,
} from "./lib/inputs.ts";
export {
  Answers,
  State,
  SourceConfig,
  qualifiedAnswers,
  validateSources,
  commitPattern,
  decodeSavedIntent,
  loadPreviousIntent,
  selectionFilename,
  type Answer,
  type SavedIntent,
} from "./lib/selections.ts";
export type {
  BundleDeclaration,
  BundleInfo,
  JsonValue,
  LoadedBundle,
  LoadedPolicy,
  NativeFile,
  PolicyCatalog,
  PolicySelections,
  SourceRevision,
  PolicySource,
  FileDeclaration,
} from "./lib/bundle-types.ts";

export {
  createSourceStore,
  repositoryIdentity,
  type SourceStore,
  type SourceTransport,
} from "./lib/sources.ts";
