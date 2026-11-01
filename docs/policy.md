# Edit policy

Edit declarations and native files under [`policy/`](../policy/), then rerun the source CLI from your target package. Policy loads afresh; ordinary edits need no installer changes or rebuild. Use a disposable target when trying a new rule, version, or migration. Inspect the plan and exercise the affected project commands before relying on the result: loading valid policy does not prove tool compatibility.

## Find the owning file

Paths in this table are relative to `policy/`:

| Change | File |
| --- | --- |
| Formatting opinions | `typescript/base/files/.oxfmtrc.json` |
| Lint rules and native type-aware options | `typescript/base/files/.oxlintrc.json` |
| Scripts, dependencies, display text, inputs, migration | The bundle's `bundle.json` |
| Tailwind sorting and lint settings | `typescript/integrations/tailwind/files/` |
| Convex lint settings | `typescript/integrations/convex/files/.oxlintrc.json` |
| Pre-commit commands | `typescript/automation/husky/files/.husky/its-checks-pre-commit` |
| CI commands | `typescript/automation/github-actions/files/.github/workflows/its-checks.yml` |
| Repository/schema identity | Root `bundle.json` |

These are editable opinions, not frozen framework baselines. For example, add `"semi": false` to the baseline formatter object or change a lint rule in its owning fragment. Generated target edits can be replaced on rerun; edit policy to keep them.

## Directory layout

```text
policy/
  bundle.json
  typescript/
    base/
      bundle.json
      files/...
    integrations/<id>/
      bundle.json
      files/...
    automation/<id>/
      bundle.json
      files/...
```

Baseline is mandatory. Category directories and `files/` are optional. Each bundle directory contains only `bundle.json` and optional `files/`. Add an integration/automation directory to expose a checkbox; there is no registry or declared ID field. IDs are lowercase alphanumeric words separated by hyphens. Stable keys are `base`, `integrations/<id>`, and `automation/<id>`; IDs in different categories are distinct.

Application order is baseline, integrations sorted by ID, then automation sorted by ID, using ordinal string order. Click order has no effect. Invalid declarations fail discovery even if unselected; native content is loaded only for selected or still-known prior bundles.

## Declare a bundle

All bundles share the same strict-JSON shape. Only `name` is required:

```json
{
  "name": "Project style",
  "description": "Checks for this project",
  "scripts": { "check": "node scripts/project-check.mjs" },
  "dependencies": { "project-runtime": "1.2.3" },
  "devDependencies": { "project-checker": "2.0.0" },
  "inputs": [
    {
      "id": "stylesheet",
      "prompt": "Stylesheet path?",
      "type": "path",
      "default": "src/styles.css",
      "destination": {
        "file": ".oxfmtrc.json",
        "field": ["sortTailwindcss", "stylesheet"]
      }
    }
  ],
  "migration": {
    "removeFiles": ["old-checks.json"],
    "removeDependencies": ["old-runtime"],
    "removeDevDependencies": ["old-checker"]
  }
}
```

Package names/commands above illustrate the syntax; supply real dependencies and files for your project. With that input, the same bundle needs `files/.oxfmtrc.json` containing the destination:

```json
{ "sortTailwindcss": { "stylesheet": "src/styles.css" } }
```

| Field | Contract |
| --- | --- |
| `name`, `description` | Nonblank display strings; `description` is optional |
| `scripts` | Map of public script names to nonblank opaque commands without NUL; names start with a letter/digit, then use letters, digits, `:`, `_`, or `-`; `its-checks:` is reserved |
| `dependencies`, `devDependencies` | Lowercase npm-style names to nonblank literal requirements without control characters; versions, ranges, tags, and URLs are not resolved during loading |
| `inputs` | Ordered typed questions bound to fields in this bundle's own JSON/JSONC files |
| `migration` | Optional exact removal arrays; no globs, package-manifest removal, inferred cleanup, or executable migration handlers |

Unknown fields and duplicate JSON keys fail. One bundle cannot put a dependency in both sections. Across selected bundles, requirements for a package must agree **literally**, even if ranges overlap. If any bundle puts an agreed requirement in `dependencies`, that section wins; otherwise it goes in `devDependencies`. The other of those two sections loses that package. Optional/peer sections and unrelated manifest values remain. Replacing existing requirements requires confirmation.

### Dependency security

Audit the installed target tooling graph separately from the installer's lockfile. Known risk: the Tailwind tooling chain can include `minimatch < 11.0.1`, affected by [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), a denial-of-service advisory. Reachability through the configured tools has not been established. Passing compatibility checks does not resolve this risk; recheck tool compatibility before forcing dependency overrides.

## Declare inputs

Input `id` uses the bundle-ID syntax and is unique within the bundle. `prompt` is nonblank. `type` is `string`, `number`, `boolean`, or `path`; defaults are optional and must match. Strings can be empty, numbers must be finite, and booleans use Yes/No questions. Defaults and saved answers are editable prefills, not silently accepted values. Native placeholders do not create defaults or questions.

`destination.file` names one JSON/JSONC file in the same bundle. `field` is a nonempty array of object-key strings or nonnegative integer array indexes, for example `["overrides", 0, "rules", "no-debugger"]`. The field must already exist. Numeric strings do not index arrays. Prototype keys, duplicate destinations, and ancestor/descendant overlaps fail. The answer can replace a placeholder of another type, but must match the declared input type.

Path answers are saved and bound unchanged relative to the **target package root**, not the checkout. They need not exist during setup. Use safe POSIX relative paths without traversal, empty components, Windows syntax, reserved names, `.git`, or `node_modules`. A runtime tool may impose additional requirements.

Bindings happen before composition. Each input has one destination; there is no YAML/shell substitution, expression evaluation, or multi-destination binding. Tailwind therefore declares two inputs for the same v4 stylesheet. Saved incompatible types/paths fail rather than being coerced. Deselected/retired answers are dropped from new intent.

## Author native files

`files/` mirrors target-relative paths. Supported content is object-root JSON, JSONC with comments/trailing commas, single-document YAML with unique keys, `.sh`, and extensionless `.husky/` hooks. Shell and YAML are copied as authored; shell is not syntax-checked or executed by setup, and YAML validation does not validate command behavior. Executable policy-file bits make new outputs executable; existing output modes are retained.

Do not author `files/package.json` at any depth: use declaration maps. `.its-checks.json` is reserved. Paths must be safe portable relative paths; symlinks, nonregular files, case aliases, unsafe traversal/names, `.git`, and `node_modules` are rejected. Files must be valid UTF-8. JSON duplicate keys, prototype-mutating keys, and nonfinite values fail.

References such as `$schema`, Oxlint `extends`, plugin specifiers, and path strings are retained, not fetched or rebased. Author them for the target root. Generated configuration is standalone; do not reference checkout-local fragments. Tool-specific schema validity and package/rule availability are your responsibility.

### Compose Oxc fragments

Each bundle can supply `.oxfmtrc.json` **or** `.oxfmtrc.jsonc`, and `.oxlintrc.json` **or** `.oxlintrc.jsonc`, not both forms for a tool. Both compose to canonical `.json` output. Only selected fragments contribute; existing target rules never participate. Both configs are generated even if empty.

| Field | Composition |
| --- | --- |
| Oxlint `rules` | Merge by exact rule name; later whole entries replace earlier entries, including severity/options tuples; no identity normalization |
| Oxlint `categories`, `env`, `globals`, `settings`, `options` | Shallow merge by exact key; nested values are atomic; explicit `false` survives |
| Oxlint `plugins`, `jsPlugins`, `extends` | Append in bundle order; deduplicate by exact JSON value, ignoring object-key order; first occurrence keeps its position |
| Both tools `overrides` | Append complete entries in order, without merging or deduplication |
| Oxfmt `extends` | Rejected |
| Every other top-level field | Last supplied **whole value** wins; omission contributes nothing |

The last row includes **`ignorePatterns`**, `$schema`, formatter `associations`, `sortImports`, `sortTailwindcss`, structured options, and other arrays. Ignore patterns are **not appended**. For example, selecting the current Convex fragment replaces baseline Oxlint ignores with its generated-directory pattern; include all desired ignores in the later fragment if you need them retained. `null` is an atomic value, not a deletion command; map/list fields must still have their required shapes.

Plugin aliases/specifiers remain distinct. Composition does not expand default plugins, evaluate presets, resolve packages, or implement native-tool inheritance. JS plugin rules do not gain TypeScript type information from native `options.typeAware`.

Changed output uses sorted object keys, two-space indentation, a trailing newline, and retained array order. A semantically matching existing Oxc JSON/JSONC file retains its exact bytes and mode. Other dedicated destinations accept identical shared contributions but reject differing bytes or executable flags instead of choosing a winner.

## Compose project scripts

Same-name selected contributions run sequentially in bundle order, with exact-string deduplication and stop-on-failure between expressions. Existing public command bytes run first. Each expression runs in its own subshell, so working-directory/environment changes do not carry to the next one. Commands remain opaque POSIX shell programs; setup does not rewrite their internal pipelines or recovery logic.

Setup owns `its-checks:<public-name>` helpers and exact public wrappers. For example, a new npm `check` delegates to `npm run its-checks:check`. If a prior public command exists, its generated wrapper is `(`, newline, original command bytes, two newlines, `) && `, then that helper runner. Keep this exact form for automatic restoration and manager changes. Edit policy commands rather than hand-editing wrappers; see [script conflicts](usage.md#resolve-conflicts).

Helpers are rebuilt, not repeatedly appended. On identifiable deselection, the original public command is restored, or the wrapper removed if there was none. No backup/history is saved. Use `node --run <name>` for manager-neutral calls to another project command. Husky uses root `postinstall`, not `prepare`, for the documented Bun lifecycle contract.

## Native automation

Author dedicated workflows under `.github/workflows/`. Put pre-commit commands only in `.husky/its-checks-pre-commit`, not the shared `.husky/pre-commit`. Every dedicated file must begin with this exact line, optionally immediately after a shell shebang:

```sh
# its-checks: managed
```

Keep the marker when editing. Marked existing automation can be replaced/removed with confirmation, including local edits. Unmarked content is a hard conflict, also for migration and deselection. Adding the marker manually explicitly adopts a file; setup never infers ownership from its commands. Unlisted workflows remain untouched.

The shared `.husky/pre-commit` gets one invocation block:

```sh
# BEGIN its-checks
sh .husky/its-checks-pre-commit
# END its-checks
```

Surrounding commands, bytes, and existing mode remain. New shared hooks are executable. One intact ordered whole-line delimiter pair identifies the region even if its invocation changes. Duplicate, nested, reversed, indented, or malformed recognizable delimiters fail before mutation.

The appended block owns one preceding line separator and no separator after its END delimiter; it uses CRLF if present in the original, otherwise LF. Preserve that convention if moving it manually. Removal restores surrounding bytes, including an originally missing final newline, but leaves the shared file itself. No shell parser or YAML job merger is used.

## Migration and cleanup

Selected bundles' `migration` arrays remove only exact named files or dependencies from the named section, with confirmation. Selected requirements take precedence over dependency removals. A selected output cannot also be removed. Migration of `.husky/pre-commit` removes only the managed block; dedicated automation still needs its ownership marker.

Setup also proposes removal of competing `.oxfmtrc.jsonc`, `.oxlintrc.jsonc`, and `oxfmt.config.*` / `oxlint.config.*` with `ts`, `mts`, `cts`, `js`, `mjs`, or `cjs` suffixes. These are explicit candidates, not a claim that all names auto-discover in every release. Executable configs are never imported. Check the current baseline declaration for its additional Prettier, ESLint, and Biome removal list; unlisted legacy setup remains.

Deselection uses prior intent and **current** definitions only. Files/dependencies still required by selected bundles survive. Renamed/disappeared paths, names, or retired bundles are not reconstructed and may need manual cleanup. No ownership inventory, command backup, or historical bundle version exists. Removing Husky does not undo lifecycle Git settings/dispatch files; follow [recovery guidance](usage.md#recover-from-failure).

## Source identity and the editor schema

Root `policy/bundle.json` declares the policy format (`schemaVersion: 1`) and its editable `source` metadata. This authoring metadata selects the repository and editor schema; it is not copied wholesale into the target's saved file. For a fork:

1. Set `source.repository` to your HTTPS repository URL without credentials, query, or fragment. Update the descriptive repository link in [`schemas/its-checks.schema.json`](../schemas/its-checks.schema.json).
2. Commit the schema at a safe repository-relative `.json` path, normally `schemas/its-checks.schema.json`.
3. Set `source.revision` to that known schema-containing commit's full lowercase hash, and `source.selectionSchema` to its path. This selects the **editor schema**, independently of the executing code revision.
4. Publish that commit and ensure `<repository>/raw/<revision>/<schema-path>` is reachable through a GitHub-compatible raw endpoint. Runtime decoding never fetches it. Ordinary code/policy edits do not require updating this schema pin.

### Saved project intent

The generated `.its-checks.json` records the following fields (commit values below are placeholders):

```json
{
  "$schema": "https://example.com/fork/raw/<schema-commit>/schemas/its-checks.schema.json",
  "source": "https://example.com/fork",
  "commit": "<actual-generating-commit-when-known>",
  "integrations": ["tailwind"],
  "automation": ["husky"],
  "answers": { "integrations/tailwind": { "formatter-stylesheet": "src/styles.css" } }
}
```

`$schema` is an editor aid. `source` is the configured repository. The optional `commit` is the executing generator's full revision, not the schema commit and not today's remote HEAD. It is omitted rather than written as `null`, a branch name, or a guess when identity is unavailable. Arrays and answers prefill subsequent dialogues. There is no saved format-version field or duplicated schema-source object.

The CLI uses only local provenance: a clean Git checkout at the executed package root, or its own installed package's native npm/Bun lock metadata. It does not search the target repository, query GitHub, fetch revisions, or add a marker file. Dirty/untracked checkout edits, unpacked archives, malformed/missing/ambiguous native metadata, and unresolved short hashes omit `commit`. npm/npx records a full resolved Git revision. Bunx 1.4 default-branch cache entries expose only a short hash, so that case omits it; a full requested pin is recorded only when its repository and resolved prefix agree. Cache metadata is not an attestation against manually edited cache contents.

Only this saved-file format is supported. Unsupported shapes or invalid values stop setup before any target changes; reading a saved file never rewrites it.

Intent is saved before dependency installation and is not installation success, an ownership/history file, or a pin for future CLI launches. A changed generating commit alone does not require dependency installation or lifecycle execution.
