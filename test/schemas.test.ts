import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { test } from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";
import { Effect } from "effect";

import { decodeSavedIntent } from "../src/modules/policy/index.ts";
import { json } from "./shared/assertions.ts";

await test("published schemas describe source-pinned state, headless manager selection, and uniform bundles", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  const stateSchema = json(await fs.readFile("schemas/its-checks.schema.json", "utf8"));
  ajv.addSchema(stateSchema, "its-checks.schema.json");
  const state = ajv.getSchema("its-checks.schema.json");
  assert.ok(state !== undefined);
  const intent = {
    schemaVersion: 2,
    sources: [
      { repository: "example/policy", commit: "a".repeat(40), bundles: ["checks"], answers: {} },
    ],
  };
  assert.equal(state(intent), true, ajv.errorsText(state.errors));
  await Effect.runPromise(decodeSavedIntent(JSON.stringify(intent)));
  assert.equal(state({ integrations: [], automation: [] }), false);
  assert.equal(state({ ...intent, sources: [{ ...intent.sources[0], commit: "main" }] }), false);
  const setup = ajv.compile(json(await fs.readFile("schemas/setup.schema.json", "utf8")));
  assert.equal(setup({ ...intent, packageManager: "pnpm" }), true, ajv.errorsText(setup.errors));
  assert.equal(setup({ ...intent, packageManager: "unsupported" }), false);
  const bundle = ajv.compile(json(await fs.readFile("schemas/bundle.schema.json", "utf8")));
  const declaration = {
    name: "Checks",
    description: "Example policy",
    requires: ["shared"],
    files: [
      {
        source: "files/config.json",
        target: "config.json",
        operation: "compose",
        format: "json",
        arrays: { "/ignores": "append-unique" },
      },
    ],
  };
  assert.equal(bundle(declaration), true, ajv.errorsText(bundle.errors));
  assert.equal(
    bundle({ ...declaration, files: [{ source: "files/doc", target: "doc", operation: "merge" }] }),
    false,
  );
});
