import * as path from "node:path";

import { Effect } from "effect";

import { canonical } from "../documents.ts";
import type { BundleError } from "./bundle-errors.ts";
import {
  checkPath,
  compare,
  decode,
  directory,
  fail,
  json,
  readText,
  unique,
  validate,
} from "./bundle-io.ts";
import { nativeFiles } from "./bundle-native.ts";
import {
  BundleDeclaration,
  RootDeclaration,
  type BundleInfo,
  type BundleKind,
  type LoadedPolicy,
  type PolicyCatalog,
  type PolicySelections,
} from "./bundle-types.ts";
import { checkDeclaration } from "./bundle-validation.ts";
const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function bundle(root: string, kind: BundleKind, id: string) {
  const key =
    kind === "base" ? "base" : `${kind === "integration" ? "integrations" : "automation"}/${id}`;
  const dir = path.join(root, "typescript", key);
  const ctx = { bundle: key, source: path.join(dir, "bundle.json") };
  return Effect.gen(function* () {
    const entries = yield* directory({ ...ctx, source: dir });
    yield* validate(
      ctx,
      "$",
      entries.every((entry) => entry === "bundle.json" || entry === "files"),
      "Bundle directories contain only bundle.json and files/; executable installers are not supported",
    );
    const declaration = yield* decode(
      ctx,
      BundleDeclaration,
      yield* json(ctx, yield* readText(ctx), false),
    );
    yield* checkDeclaration(ctx, declaration);
    return { id, key, kind, directory: dir, source: ctx.source, declaration } satisfies BundleInfo;
  });
}

/** Discover display metadata without loading unselected native policy. No target filesystem is accepted. */
export function discoverPolicy(policyRoot: string): Effect.Effect<PolicyCatalog, BundleError> {
  return Effect.gen(function* () {
    const root = path.resolve(policyRoot);
    const ctx = { bundle: "policy", source: path.join(root, "bundle.json") };
    yield* directory({ ...ctx, source: root });
    yield* directory({ ...ctx, source: path.join(root, "typescript") });
    const declaration = yield* decode(
      ctx,
      RootDeclaration,
      yield* json(ctx, yield* readText(ctx), false),
    );
    const url = URL.parse(declaration.source.repository);
    yield* validate(
      ctx,
      "source.repository",
      url !== null &&
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "",
      "Expected an HTTPS repository URL without credentials, query, or fragment",
    );
    yield* checkPath(ctx, "source.selectionSchema", declaration.source.selectionSchema);
    yield* validate(
      ctx,
      "source.selectionSchema",
      declaration.source.selectionSchema.endsWith(".json"),
      "Expected a repository-relative JSON Schema path",
    );
    const baseline = yield* bundle(root, "base", "base");
    const discover = (kind: "integration" | "automation") =>
      Effect.gen(function* () {
        const parent = path.join(
          root,
          "typescript",
          kind === "integration" ? "integrations" : "automation",
        );
        const ids = yield* directory({ bundle: "policy", source: parent }, true);
        yield* unique({ bundle: "policy", source: parent }, "$", ids);
        const bundles: BundleInfo[] = [];
        for (const id of ids) {
          yield* validate(
            { bundle: id, source: parent },
            "$",
            identifier.test(id),
            "Bundle directory IDs must be lowercase words separated by hyphens",
          );
          bundles.push(yield* bundle(root, kind, id));
        }
        return bundles;
      });
    return {
      root,
      declaration,
      baseline,
      integrations: yield* discover("integration"),
      automation: yield* discover("automation"),
    };
  });
}

/** Load baseline and explicit selections. Read-only: never executes policy, installs, or writes. */
export function loadPolicy(
  policyRoot: string,
  selections: PolicySelections,
): Effect.Effect<LoadedPolicy, BundleError> {
  return Effect.gen(function* () {
    const catalog = yield* discoverPolicy(policyRoot);
    const selected: BundleInfo[] = [catalog.baseline];
    for (const kind of ["integrations", "automation"] as const) {
      const ctx = { bundle: "policy", source: catalog.root };
      yield* unique(ctx, `selections.${kind}`, selections[kind]);
      for (const id of [...selections[kind]].toSorted(compare)) {
        const info = catalog[kind].find((candidate) => candidate.id === id);
        if (info === undefined) {
          return yield* fail(ctx, `selections.${kind}`, `Unknown bundle ID ${canonical(id)}`);
        }
        selected.push(info);
      }
    }
    const bundles = [];
    for (const info of selected) {
      bundles.push(yield* nativeFiles(info));
    }
    return { root: catalog.root, declaration: catalog.declaration, bundles };
  });
}
