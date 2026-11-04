import { Schema } from "effect";

const Text = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0 || "Must not be blank"),
);
const Strings = Schema.Record(Schema.String, Text);
const InputValue = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);
export const FileDeclaration = Schema.Struct({
  source: Text,
  target: Text,
  operation: Schema.Literals(["seed", "compose", "replace"]),
  format: Schema.optionalKey(Schema.Literals(["json", "jsonc"])),
  arrays: Schema.optionalKey(Schema.Record(Schema.String, Schema.Literal("append-unique"))),
  executable: Schema.optionalKey(Schema.Boolean),
  replaces: Schema.optionalKey(Schema.Record(Schema.String, Text)),
});
export type FileDeclaration = typeof FileDeclaration.Type;
export const BundleDeclaration = Schema.Struct({
  name: Text,
  description: Text,
  requires: Schema.optionalKey(Schema.Array(Text)),
  hidden: Schema.optionalKey(Schema.Boolean),
  files: Schema.optionalKey(Schema.Array(FileDeclaration)),
  scripts: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Union([Text, Schema.Struct({ command: Text, replaces: Text })]),
    ),
  ),
  dependencies: Schema.optionalKey(Strings),
  devDependencies: Schema.optionalKey(Strings),
  inputs: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Text,
        prompt: Text,
        type: Schema.Literals(["string", "number", "boolean", "path"]),
        default: Schema.optionalKey(InputValue),
        destination: Schema.Struct({
          file: Text,
          field: Schema.Array(
            Schema.Union([
              Text,
              Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
            ]),
          ),
        }),
      }),
    ),
  ),
});
export type BundleDeclaration = typeof BundleDeclaration.Type;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export interface SourceRevision {
  readonly repository: string;
  readonly commit: string;
}
export interface PolicySource extends SourceRevision {
  readonly root: string;
  readonly bundles: readonly string[];
}
export interface BundleInfo {
  readonly id: string;
  readonly key: string;
  readonly repository: string;
  readonly directory: string;
  readonly source: string;
  readonly declaration: BundleDeclaration;
}
export interface PolicyCatalog {
  readonly root: string;
  readonly bundles: readonly BundleInfo[];
}
export type PolicySelections = readonly string[];
export type NativeFile = {
  readonly path: string;
  readonly source: string;
  readonly content: string;
  readonly executable: boolean;
  readonly operation: "seed" | "compose" | "replace";
  readonly arrays: Readonly<Record<string, "append-unique">>;
  readonly replaces: Readonly<Record<string, string>>;
} & (
  | { readonly format: "json" | "jsonc"; readonly value: JsonValue }
  | { readonly format: "text" }
);
export interface LoadedBundle extends BundleInfo {
  readonly files: readonly NativeFile[];
}
export interface LoadedPolicy {
  readonly root: string;
  readonly sources: readonly PolicySource[];
  readonly bundles: readonly LoadedBundle[];
}
