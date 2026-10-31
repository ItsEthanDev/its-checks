# Bundle-loading reference

`src/bundles.ts` is the public read-only seam. This module discovers and validates external policy; it does not compose a plan, bind input answers, write target files, install packages, or execute policy. There is no shipped policy yet.

## Development

Requires Node 24 or newer. Exact dependencies are recorded in `package-lock.json`.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
```

Tests use Node's built-in TypeScript support and test runner with real temporary policy/project directories. No transpiler, test framework, build step, or package lifecycle scripts are needed. Tests clean up their temporary directories.

Effect is pinned to **4.1.1**. Implementation evidence: first-party [v4 Schema introduction](https://effect.website/docs/v4/schema/introduction/) and [resource scopes](https://effect.website/docs/v4/resource-management/scope/), plus installed `effect/dist/{Schema,SchemaAST,Effect,Data}.d.ts`. APIs used include `Schema.Struct`, `Schema.optionalKey`, `Schema.Record(key, value)`, `Schema.Union([...])`, `Schema.decodeUnknownEffect`, `Data.TaggedError`, `Effect.gen`, `Effect.tryPromise`, and `Effect.acquireUseRelease`. File handles close on success, failure, and interruption. Repository-local installation disables lifecycle scripts; dependency manifests were inspected before installation. TypeScript 6 satisfies v4's documented minimum of 5.9; Node runs the erasable TypeScript directly.

## Interface

```ts
import { discoverPolicy, loadPolicy } from "../src/bundles.ts";

// Effect<PolicyCatalog, BundleError>; no services required
const catalog = discoverPolicy("/checkout/policy");

// Effect<LoadedPolicy, BundleError>; baseline is implicit
const policy = loadPolicy("/checkout/policy", {
  integrations: ["tailwind"],
  automation: ["husky"],
});
```

`discoverPolicy` reads root provenance and every bundle declaration for display. It does not load native files. `loadPolicy` discovers again, validates explicit selections, and loads baseline plus selected native files. Invalid unselected declarations fail discovery; unselected native content is not read. Unknown or duplicate selections fail.

Directory layout:

```text
policy/bundle.json
policy/typescript/base/bundle.json
policy/typescript/base/files/...
policy/typescript/integrations/<id>/bundle.json
policy/typescript/integrations/<id>/files/...
policy/typescript/automation/<id>/bundle.json
policy/typescript/automation/<id>/files/...
```

Optional category directories and `files/` may be absent. Each bundle directory contains only `bundle.json` and optional `files/`. There is no registry, declared bundle ID, or executable installer entry point. IDs are lowercase alphanumeric words separated by hyphens. Namespaced keys are `base`, `integrations/<id>`, and `automation/<id>`; the same ID in different categories is distinct. Display names need not be unique.

Ordering uses ordinal JavaScript string comparison, not locale or filesystem order: baseline, sorted integration IDs, sorted automation IDs. Native file paths are sorted within each bundle. Selection order has no effect.

`LoadedPolicy` retains root provenance and ordered `LoadedBundle` values. Each bundle includes its declaration, stable key, directory, declaration source, and files. Each native file retains its target-relative `path`, absolute `source`, original UTF-8 `content`, executable-bit boolean, and discriminated `format`. JSON/JSONC files also expose parsed `value`; YAML/shell remain authored text. Overlapping destinations across bundles are allowed for later composition; duplicate/case-alias destinations within a bundle fail.

## Root declaration

`policy/bundle.json` is strict JSON:

```json
{
  "schemaVersion": 1,
  "source": {
    "repository": "https://github.com/example/fork",
    "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "selectionSchema": "schemas/selections.schema.json"
  }
}
```

`repository` is an HTTPS repository URL without credentials, query, or fragment. `revision` is a full immutable Git revision (40 or 64 lowercase hex digits). `selectionSchema` is a safe repository-relative `.json` path. These are editable metadata, never hardcoded upstream identity. Loading does not resolve the revision, fetch the repository/schema, or verify schema publication. Selection-file/schema generation and actual revision-pinned URL construction belong to the saved-intent module, not this loader.

## Bundle declaration

Every kind uses the same strict JSON declaration. Only `name` is required:

```json
{
  "name": "Example integration",
  "description": "Shown with the choice",
  "scripts": { "check": "some-tool ." },
  "dependencies": { "some-runtime": "1.2.3" },
  "devDependencies": { "some-tool": "1.2.3" },
  "inputs": [
    {
      "id": "stylesheet",
      "prompt": "Stylesheet path?",
      "type": "path",
      "default": "src/app.css",
      "destination": {
        "file": ".oxfmtrc.jsonc",
        "field": ["sortTailwindcss", "stylesheet"]
      }
    }
  ],
  "migration": {
    "removeFiles": ["prettier.config.js"],
    "removeDependencies": ["old-runtime"],
    "removeDevDependencies": ["prettier"]
  }
}
```

- Unknown fields, blank display text, duplicate JSON keys, and incorrectly typed fields fail. There are no script groups or executable handlers.
- Script names use letters, digits, `:`, `_`, and `-`, starting with a letter/digit. `its-checks:` is reserved. Commands are nonblank opaque strings without NUL, not parsed or run by this module.
- Dependency maps use lowercase npm-style package names and nonblank requirements without control characters (versions, ranges, tags, or URLs). The loader does not resolve requirements or check registry availability. One bundle cannot declare a package in both dependency sections. Cross-bundle dependency collision checks belong to planning.
- Migration arrays identify explicit files and dependencies, not patterns or inferred cleanup. File entries must be safe relative paths and cannot name a package manifest. Duplicate/case-alias entries fail. Loading proposes or performs no removals.
- Input IDs use the directory-ID syntax and are unique within their bundle. Types are `string`, `number`, `boolean`, and `path` (a target-relative string). Optional defaults must match their type; default paths must be safe but need not exist. No implicit default is generated.
- Each input has one destination in its own bundle's JSON/JSONC file. `field` is a nonempty array of string object keys or nonnegative integer array indexes, without prototype keys. The field must already exist in the native fragment; the loader does not bind defaults or require the authored placeholder's type to match the input type. Duplicate destinations fail. Multiple destinations, YAML/shell bindings, answer collection, saved-answer semantics, and actual answer validation are not implemented here.

## Native files and validation limits

`files/` mirrors target-relative paths. Supported formats are `.json` (strict JSON), `.jsonc` (comments/trailing commas), `.yaml`/`.yml` (one syntactically valid document with unique mapping keys), `.sh`, and extensionless `.husky/` hooks. JSON configuration roots must be objects. Native `$schema`/`extends` references and target-relative strings remain intact; no referenced schema, preset, or package is fetched. Shell is copied as text, not syntax-checked or executed. YAML is syntax-checked, not evaluated. Tool-specific Oxc compatibility is not validated by this module.

Paths cannot be absolute, empty, traversing, contain Windows separators/drive/alternate-stream syntax, control characters, Windows-reserved names/characters, trailing dots/spaces, `.git`, or `node_modules`. Case-alias identities and file paths fail. `package.json` is forbidden at every depth in `files/`; package contributions belong in the declaration. Symbolic links and nonregular files are rejected, including linked bundle/native directories. UTF-8 decoding is strict. JSON duplicate keys, prototype-mutating `__proto__` keys, and nonfinite parsed numbers fail.

Policy roots are trusted local checkouts, not a sandbox against concurrently replaced ancestor directories. Native shell scripts are target artifacts, not integration installers: they may be executable but are never executed by loading. Future application must validate target state separately; source-path checks do not make target symlinks safe.

Expected failures use `BundleError` with `_tag`, `bundle`, `source`, `field`, and `detail`. The message includes all context. Schema errors use `$` as the outer field and include nested decoder paths in `detail`; malformed JSON includes offsets, YAML includes parser locations, and filesystem errors identify the attempted source. No target path or dependency-operation adapter exists in this interface, so failure cannot mutate the target or run installation.
