import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Effect } from "effect";

import type { BundleError } from "./bundle-errors.ts";
import {
  compare,
  decode,
  directory,
  fail,
  io,
  json,
  readText,
  unique,
  validate,
} from "./bundle-io.ts";
import { nativeFiles } from "./bundle-native.ts";
import {
  BundleDeclaration,
  type BundleInfo,
  type LoadedPolicy,
  type PolicyCatalog,
  type PolicySelections,
  type SourceRevision,
} from "./bundle-types.ts";
import { checkDeclaration } from "./bundle-validation.ts";

export const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Discover only declarations. Source identity is provided by the fetcher, never by policy content. */
export function discoverPolicy(
  policyRoot: string,
  repository: string,
): Effect.Effect<PolicyCatalog, BundleError> {
  return Effect.gen(function* () {
    const root = path.resolve(policyRoot);
    const ctx = { bundle: repository, source: root };
    const bundles: BundleInfo[] = [];
    const entries = yield* directory(ctx);
    yield* unique(ctx, "$", entries);
    for (const id of entries) {
      const dir = path.join(root, id);
      const stat = yield* io(ctx, () => fs.lstat(dir));
      if (stat.isFile() && id === "README.md") {
        continue;
      }
      yield* validate(
        ctx,
        id,
        identifier.test(id) && stat.isDirectory(),
        "Expected a lowercase hyphenated bundle directory (or README.md)",
      );
      const source = path.join(dir, "bundle.json");
      const context = { bundle: `${repository}:${id}`, source };
      const children = yield* directory({ ...context, source: dir });
      yield* validate(
        context,
        "$",
        children.every((entry) => entry === "bundle.json" || entry === "files"),
        "Bundle directories contain only bundle.json and files/; executable installers are unsupported",
      );
      const declaration = yield* decode(
        context,
        BundleDeclaration,
        yield* json(context, yield* readText(context), false),
      );
      yield* checkDeclaration(context, declaration);
      bundles.push({
        id,
        key: `${repository}:${id}`,
        repository,
        directory: dir,
        source,
        declaration,
      });
    }
    return { root, bundles };
  });
}

/** Resolve a source-local dependency graph in deterministic dependency-first order. */
export function loadPolicy(
  policyRoot: string,
  selections: PolicySelections,
  revision: SourceRevision,
): Effect.Effect<LoadedPolicy, BundleError> {
  return Effect.gen(function* () {
    const catalog = yield* discoverPolicy(policyRoot, revision.repository);
    const ctx = { bundle: revision.repository, source: catalog.root };
    yield* unique(ctx, "bundles", selections);
    const selected: BundleInfo[] = [];
    const complete = new Set<string>();
    const visiting: string[] = [];
    const visit = (id: string): Effect.Effect<void, BundleError> =>
      Effect.gen(function* () {
        if (visiting.includes(id)) {
          return yield* fail(
            ctx,
            "requires",
            `Dependency cycle: ${[...visiting, id].join(" -> ")}`,
          );
        }
        if (complete.has(id)) {
          return undefined;
        }
        const info = catalog.bundles.find((bundle) => bundle.id === id);
        if (info === undefined) {
          return yield* fail(
            ctx,
            "requires",
            `Missing bundle ${id}, required by ${visiting.at(-1) ?? "explicit selection"}`,
          );
        }
        visiting.push(id);
        for (const dependency of (info.declaration.requires ?? []).toSorted(compare)) {
          yield* visit(dependency);
        }
        visiting.pop();
        complete.add(id);
        selected.push(info);
        return undefined;
      });
    for (const id of selections.toSorted(compare)) {
      const info = catalog.bundles.find((bundle) => bundle.id === id);
      if (info?.declaration.hidden === true) {
        return yield* fail(
          ctx,
          "bundles",
          `Bundle ${id} is dependency-only; revise the explicit selection`,
        );
      }
      yield* visit(id);
    }
    const bundles = yield* Effect.forEach(selected, nativeFiles);
    return {
      root: catalog.root,
      sources: [{ ...revision, root: catalog.root, bundles: selections.toSorted(compare) }],
      bundles,
    };
  });
}
