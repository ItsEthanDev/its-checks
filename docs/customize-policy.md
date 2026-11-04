# Author a policy repository

Create a GitHub repository with bundles directly under `policy/`. Policy authors do not need to fork or release the CLI.

```text
policy/
  typescript/
    bundle.json
    files/
      linter.json
  conventions/
    bundle.json
    files/
      CONTRIBUTING.md
```

Commit declarations and native UTF-8 files, then consume the repository:

```sh
npx --yes 'ItsEthanDev/its-checks' add YOUR-USERNAME/policies
```

Policy updates become available through the explicit `update` operation. Uncommitted edits and CLI upgrades do not change pinned policy content.

## Declare bundles and dependencies

The [bundle schema](../schemas/bundle.schema.json) describes declaration fields. Each directory name is a stable lowercase hyphenated bundle ID. `name` and `description` are required display metadata. A directory rename changes identity. There is no root manifest or privileged baseline/category.

```json
{
  "name": "Project conventions",
  "description": "Starter contributor guidance and shared checks.",
  "requires": ["typescript"],
  "files": [
    {
      "source": "files/CONTRIBUTING.md",
      "target": "CONTRIBUTING.md",
      "operation": "seed"
    }
  ]
}
```

`requires` contains IDs from the same source revision, not repository references. Selecting a bundle includes transitive requirements. Missing bundles and cycles fail planning. Set `hidden: true` for dependency-only bundles; they cannot be explicitly selected but appear with dependency explanations in the plan.

Bundles install policy tooling, not application libraries, frameworks, or compilers. Leave those prerequisites to the project. Extract shared bundles only for genuinely shared contributions.

Bundle directories contain only `bundle.json` and `files/`. No executable installers, symlinks, or code evaluation are supported. Package scripts are declared contributions and may execute later through the project's normal package-manager lifecycle; disclose their purpose in the bundle description.

## Declare file ownership

Every file contribution declares `source`, `target`, and `operation`:

| Operation | Application                                       | Deselection or source removal                                  |
| --------- | ------------------------------------------------- | -------------------------------------------------------------- |
| `seed`    | Create only if absent; preserve existing bytes    | Leave behind as project-owned content                          |
| `replace` | Write the complete declared file                  | Propose deleting it if no selected bundle supplies it          |
| `compose` | Manage declared JSON fields using the rules below | Remove prior declared contributions; preserve unrelated fields |

`source` must be under the bundle's `files/`; `target` is relative to the target project. Paths must not escape the project or traverse `.git`, `node_modules`, or symlinks. Root `package.json` and `.its-checks.json` use dedicated contracts and cannot be file targets. Set `executable: true` when the output needs executable permissions; source-file mode is not an ownership declaration.

For typed inputs or composition, declare `format: "json"` or `"jsonc"`. Composition requires an object document. Seed/replace can write other UTF-8 formats, including Markdown, YAML, shell hooks, and extensionless files. The CLI does not infer behavior from filenames.

Compose and replace overwrite edits within their managed scope. No override declaration, output baseline, or edit tracking is required. Use seed for documents intentionally handed off to the project. In particular, a project-owned module index should be seeded rather than replaced.

### JSON composition

Object keys combine recursively. Identical values coalesce; incompatible values fail. There is no implicit array concatenation or source-order winner.

```json
{
  "source": "files/linter.json",
  "target": ".linter.json",
  "operation": "compose",
  "format": "json",
  "arrays": {
    "/ignorePatterns": "append-unique"
  }
}
```

Array keys are JSON Pointers: escape `/` as `~1` and `~` as `~0`. `append-unique` appends in deterministic dependency-first, then source-qualified lexical bundle order, removing exact duplicates. Bundles contributing to the same array must declare the same operation. Bundles contributing only other fields do not need to repeat that declaration. Undeclared arrays are atomic: identical arrays coalesce; different arrays conflict. Do not use concatenation for arrays whose order requires different semantics.

Prior pinned declarations and saved answers identify fields and array items to remove before recomposition. This is not a historical output baseline: direct edits to declared fields may be removed, while unrelated fields/items remain. JSON comments and formatting are not preserved when composition changes values.

### Explicit field replacement

For intentional incompatible values, a composing bundle can replace a selected ordinary contribution from the same source:

```json
{
  "source": "files/linter.json",
  "target": ".linter.json",
  "operation": "compose",
  "format": "json",
  "replaces": {
    "/rules/example~1rule": "typescript"
  }
}
```

The pointer must exist in both contributions. The target is a stable source-local bundle ID, not display text. Require the target bundle when the replacement relies on it. Cross-source replacement and replacement chains are unsupported; different replacements of the same field conflict. Removing the replacement restores the target's declared value. Other sources still participate in conflict checks.

Overlapping complete-file operations must be compatible and identical, including seeds even when the target already exists. Different operations, composition declarations, case aliases, and file/directory destination overlaps fail before application.

## Contribute dependencies and scripts

Use `dependencies`, `devDependencies`, and `scripts` in `bundle.json`, not a complete package manifest. Unrelated package fields and scripts remain intact. Identical dependency requirements coalesce; different strings fail without version-range resolution. If the same requirement appears in both dependency sections across bundles, the production section wins. These rules govern bundle contributions; existing project values at contributed package keys are replaced through the reviewed plan.

A script string contributes a command. Commands run in deterministic dependency-first order, with unrelated bundles ordered by source-qualified ID; exact duplicates coalesce. Existing project commands run before policy commands. Generated `its-checks:<script>` helpers and recognizable public wrappers let reruns replace policy commands without tracking their previous contents. That helper namespace is reserved. Edited wrappers that cannot be recognized fail rather than trigger a shell rewrite.

Replace one source-local bundle's ordinary command without adding a second pass:

```json
{
  "scripts": {
    "lint": {
      "command": "alternate-linter .",
      "replaces": "typescript"
    }
  }
}
```

The selected target must supply an ordinary string for that script. Replacement keeps its target's position; chains and cross-source replacements are unsupported. Identical replacements coalesce, conflicting replacements fail, and deselection restores the target command. Other bundles' commands and unrelated project scripts remain intact. Scripts require POSIX `/bin/sh`.

## Declare typed inputs

```json
{
  "inputs": [
    {
      "id": "stylesheet",
      "prompt": "Stylesheet path?",
      "type": "path",
      "default": "src/styles.css",
      "destination": {
        "file": ".linter.json",
        "field": ["settings", "stylesheet"]
      }
    }
  ]
}
```

Types are `string`, `number`, `boolean`, and `path`. Paths are safe project-relative POSIX paths; existence is not required. Destinations must already exist in this bundle's declared JSON/JSONC contribution; the declared format, not the filename, determines eligibility. Loading selected bundles validates destination fields and rejects overlaps before input enumeration or answer binding. Field paths use object keys and nonnegative array indexes. Discovery reads declarations only, not native file content.

Answers are scoped by repository, bundle ID, and input ID. Interactive mode offers valid saved answers or defaults; headless callers supply explicit answers even when defaults exist. Do not request secrets: answers are saved and appear in plans. Global inputs and cross-bundle answer references are unsupported.
