# Saved intent and project inputs

`src/selections.ts` and `src/inputs.ts` expose read-only Effect workflows. They require **Effect 4.1.1**, use the [bundle-loading contract](bundle-loading.md), and have no presentation or application dependency. All failures are typed `BundleError` values with bundle, source, field, and detail. No operation writes files, installs dependencies, executes native files, or fetches a schema.

## Public interfaces

```ts
import { loadPolicy } from "../src/bundles.ts";
import { loadPreviousIntent } from "../src/selections.ts";
import { enumerateInputs, resolveInputs } from "../src/inputs.ts";

// Effect<SavedIntent | undefined, BundleError>
const previous = loadPreviousIntent("/target/package");
// After displaying integration/automation choices and obtaining explicit selections:
const loaded = loadPolicy("/generator/policy", {
  integrations: ["tailwind"], automation: [],
});
// Effect<readonly DeclaredInput[], BundleError>
// enumerateInputs(policy, previousIntent) returns declarations and initialValue suggestions.
// After explicitly collecting typed answers:
// resolveInputs(policy, {
//   "integrations/tailwind": { stylesheet: "src/app.css" },
// }) returns ResolvedInputs.
```

`loadPreviousIntent(projectRoot)` reads exactly `.its-checks.json` from that package root. Missing means first use (`undefined`), not inferred integration choices. Invalid JSON, unknown fields, duplicate keys/IDs, invalid provenance, invalid answer shapes, invalid UTF-8, and nonregular files (including symbolic links) fail. Only a missing file is treated as absence. It does not inspect dependencies. The target directory and its ancestors are trusted local paths, not a concurrent-filesystem sandbox.

`decodeSavedIntent(content, source?)` offers the same offline decoder for already-read text. It accepts strict JSON, not JSONC. Its default diagnostic source is `.its-checks.json`.

`enumerateInputs(policy, previous?)` returns ordered `DeclaredInput` records: `bundle`, declaration `source`, `input`, and optional `initialValue`. Ordering follows loaded bundle order and declaration order within a bundle. Baseline, integration, and automation declarations all participate. Ordinary native values never become questions.

`resolveInputs(policy, answers)` requires explicit answers for **all** selected declared inputs. It decodes an unknown external answer map and validates destinations and answer types before returning:

- `policy`: a new `LoadedPolicy` with bound native values, ready for later composition;
- `intent`: the complete `SavedIntent`;
- `selectionFile`: target-relative `path` and complete UTF-8 `content`, including a trailing newline.

Original loaded values and files remain unchanged. Both parsed `value` and native `content` reflect bindings. JSONC comments and unrelated fields remain present. YAML and shell content are unchanged; there is no string substitution. Composition, confirmation, saving, and application belong to later modules.

## Defaults, prefill, and deselection

Always show integration and automation choices using `previous.integrations` and `previous.automation` as preselection suggestions. Never silently apply them. The same applies to input answers:

1. A saved answer for the selected bundle/input wins over its default, including `false`, `0`, and an empty string.
2. Without a saved answer, use the optional declaration default as a suggestion.
3. Without either, omit `initialValue`. Do not infer it from the authored native placeholder.
4. Require the dialogue's explicit answers at resolution. The resolver never falls back to saved values or defaults.

Saved values for currently declared inputs must still match the current type and safe-path rules; incompatible saved values fail with bundle/input context. The UI must not coerce number strings or string booleans. Strings may be empty; numbers must be finite; booleans must be native booleans.

Offline decoding cannot know which old bundles or input declarations still exist. It therefore retains structurally valid unknown/retired selections and answers for the caller to present or reconcile. Enumeration ignores answers outside current selected declarations. Resolution rejects supplied undeclared/deselected answers: pass only the answers collected from current questions. Fresh output rebuilds the answer map from selected declarations, dropping deselected/retired answers and empty namespaces. There is no hidden answer history; reselecting after saving a deselection uses defaults again.

## Paths and native destinations

A `path` answer is a safe POSIX-style path **relative to the target package root**, not the policy directory or process working directory. It is saved and bound unchanged. It need not exist: a stylesheet or other project file may be created after setup. No filesystem existence checks or symlink resolution are performed on input answers. This does not authorize future application code to traverse target symlinks.

Path validation matches bundle path validation: no absolute/traversing paths, empty components, Windows separators/drive/alternate-stream syntax, control characters, unsafe portable names, `.git`, or `node_modules`. Defaults obey the same rule.

Each input binds one already-existing field in its own native JSON/JSONC fragment. String path segments address object keys; nonnegative integer segments address array indexes. Numeric strings do not address arrays. Prototype-related keys, missing fields, YAML/shell destinations, duplicate destinations, and ancestor/descendant binding overlaps fail with source context. Bindings may replace the authored placeholder with any value of the input's declared type. Answers are bound before later field-specific composition; no arbitrary expression evaluation or template syntax exists.

## Single-file format and provenance

`.its-checks.json` contains only `$schema`, `schemaVersion: 1`, `source`, `integrations`, `automation`, and `answers`. It records **intended setup**, not successful installation. Application should save it with configuration before dependency operations; it must not be used as evidence that dependencies are installed. There is no ownership manifest, command backup, history, or extra tool-specific file.

[The JSON Schema](../schemas/selections.schema.json) uses draft 2020-12 and describes each field with a repository link. It provides editor assistance; runtime validation also checks provenance consistency and current input bindings/types. `selectionContent(intent)` validates and serializes a complete intent value. Generated selection IDs follow the loader's stable order; answer keys follow declared input order.

`source` comes from editable root `policy/bundle.json` metadata:

```json
{
  "repository": "https://github.com/example/fork",
  "revision": "<full schema-containing commit hash>",
  "selectionSchema": "schemas/selections.schema.json"
}
```

The placeholder above is not valid metadata. `selectionSchemaUrl(source)` requires a full lowercase 40- or 64-digit hexadecimal revision and constructs:

```text
<repository>/raw/<revision>/<URI-encoded schema path segments>
```

This is the GitHub-compatible raw-file endpoint convention. Forks must use a repository endpoint supporting that convention. The repository is an HTTPS URL without credentials, query, or fragment. Saved `$schema` must equal the URL derived from its own `source`; it need not match the current generator's metadata on a later run. Saved state resolves entirely offline, even if the repository is unavailable.

**Release invariant:** the metadata revision must be a real commit containing the schema at `selectionSchema` in the named repository. Commit the schema first, then pin shipped metadata to that known schema-containing revision. No published revision is supplied by this module, and test fixture hashes are not publication claims. The decoder validates shape and consistency, not commit existence or remote availability. A fork must update repository metadata and the schema's descriptive repository link. These mechanisms do not validate GitHub distribution or packaging.

## Verification

Run `npm test` and `npm run typecheck`. Tests use real temporary policies and projects through the public seams: first use, offline recovery, prefill precedence, changed answers, deselection, all bundle kinds and value types, native JSONC binding, unchanged YAML/shell, malformed saved state, invalid bindings, and no target writes. Temporary fixtures are removed after each test. Dependency installation, terminal rendering, composition/application, remote schema publication, and distribution are outside this seam.
