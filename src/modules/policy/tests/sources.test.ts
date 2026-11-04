import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { Effect } from "effect";

import { fixture } from "../../../../test/shared/fixtures.ts";
import { createSourceStore, repositoryIdentity } from "../index.ts";
const run = Effect.runPromise;
await test("sources normalize identity, pin exact commits, cache independently, and work offline", async (t) => {
  const f = await fixture(t);
  let tip = "a".repeat(40);
  let online = true;
  let fetches = 0;
  let resolutions = 0;
  const store = createSourceStore({
    cache: path.join(f.root, "cache"),
    transport: {
      resolve: () => {
        resolutions++;
        if (!online) {
          throw Error("offline");
        }
        return Promise.resolve(tip);
      },
      materialize: async (_repository, commit, destination) => {
        if (!online) {
          throw Error("offline");
        }
        fetches++;
        await fs.mkdir(path.join(destination, "policy"));
        await fs.writeFile(path.join(destination, "policy/README.md"), commit);
      },
    },
  });
  const first = await run(store.resolve("Alice/Quality"));
  assert.equal(first.repository, "alice/quality");
  tip = "b".repeat(40);
  assert.equal((await run(store.resolve("alice/quality", first.commit))).commit, first.commit);
  assert.equal(resolutions, 1);
  assert.equal(fetches, 1);
  const updated = await run(store.resolve("alice/quality"));
  assert.notEqual(updated.root, first.root);
  online = false;
  assert.equal((await run(store.resolve("ALICE/QUALITY", first.commit))).root, first.root);
  await assert.rejects(run(store.resolve("alice/quality", "c".repeat(40))), /offline/);
});
await test("failed materialization is retried, not marked ready", async (t) => {
  const f = await fixture(t);
  let count = 0;
  const store = createSourceStore({
    cache: path.join(f.root, "cache"),
    transport: {
      resolve: () => Promise.resolve("a".repeat(40)),
      materialize: async (_repo, _commit, destination) => {
        count++;
        if (count === 1) {
          throw Error("fetch failed");
        }
        await fs.mkdir(path.join(destination, "policy"));
      },
    },
  });
  await assert.rejects(run(store.resolve("a/b")), /fetch failed/);
  await run(store.resolve("a/b"));
  assert.equal(count, 2);
});
for (const reference of ["https://github.com/a/b", "../escape", "a/..", "a/b#main", "a/b/c"]) {
  await test(`reject unsupported source ${reference}`, () =>
    assert.throws(() => repositoryIdentity(reference)));
}
