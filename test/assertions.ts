import assert from "node:assert/strict";

import { Schema } from "effect";

/** Assert presence before inspecting an expected output or passing it to another API. */
export function defined<A>(value: A | undefined): A {
  assert(value !== undefined, "Expected a value, received undefined");
  return value;
}

export const json = Schema.decodeSync(Schema.fromJsonString(Schema.JsonObject));
export const object = Schema.decodeUnknownSync(Schema.JsonObject);
export const strings = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String));

/** Keep unrelated manifest fields observable while narrowing the maps these tests inspect. */
export function manifest(content: string): ReturnType<typeof json> & {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  const value = json(content);
  return {
    ...value,
    scripts: strings(value.scripts === undefined ? {} : value.scripts),
    dependencies: strings(value.dependencies === undefined ? {} : value.dependencies),
    devDependencies: strings(value.devDependencies === undefined ? {} : value.devDependencies),
  };
}
