import { Schema } from "effect";

const Text = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0 || "Must not be blank"),
);
const Strings = Schema.Record(Schema.String, Text);
const InputValue = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);

export const RootDeclaration = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  source: Schema.Struct({
    repository: Text,
    selectionSchema: Text,
  }),
});

export const BundleDeclaration = Schema.Struct({
  name: Text,
  description: Schema.optionalKey(Text),
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
  migration: Schema.optionalKey(
    Schema.Struct({
      removeFiles: Schema.optionalKey(Schema.Array(Text)),
      removeDependencies: Schema.optionalKey(Schema.Array(Text)),
      removeDevDependencies: Schema.optionalKey(Schema.Array(Text)),
    }),
  ),
});

export type RootDeclaration = typeof RootDeclaration.Type;
export type BundleDeclaration = typeof BundleDeclaration.Type;
export type BundleKind = "base" | "integration" | "automation";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface BundleInfo {
  readonly id: string;
  /** Namespaced stable identity: base, integrations/<id>, automation/<id>. */
  readonly key: string;
  readonly kind: BundleKind;
  readonly directory: string;
  readonly source: string;
  readonly declaration: BundleDeclaration;
}

export interface PolicyCatalog {
  readonly root: string;
  readonly declaration: RootDeclaration;
  readonly baseline: BundleInfo;
  readonly integrations: readonly BundleInfo[];
  readonly automation: readonly BundleInfo[];
}

export interface PolicySelections {
  readonly integrations: readonly string[];
  readonly automation: readonly string[];
}

export type NativeFile = {
  readonly path: string;
  readonly source: string;
  readonly content: string;
  readonly executable: boolean;
} & (
  | { readonly format: "json" | "jsonc"; readonly value: JsonValue }
  | { readonly format: "yaml" | "shell" }
);

export interface LoadedBundle extends BundleInfo {
  readonly files: readonly NativeFile[];
}

export interface LoadedPolicy {
  readonly root: string;
  readonly declaration: RootDeclaration;
  /** Baseline, sorted integration IDs, then sorted automation IDs. */
  readonly bundles: readonly LoadedBundle[];
}
