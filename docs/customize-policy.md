# Use your own policy

## 1. Fork

On GitHub, open [ItsEthanDev/its-checks](https://github.com/ItsEthanDev/its-checks) and click **Fork** to create your own copy.

In your fork's `policy/bundle.json`, change `source.repository` to your fork's URL, such as `https://github.com/YOUR-USERNAME/its-checks`. Generated selection files link to `source.selectionSchema` on that repository's `main` branch for editor validation.

## 2. Edit your preferences

Edit files in your fork, using GitHub's editor or a local checkout:

- `policy/typescript/base/files/`: default formatter and linter settings. For example, change `sortImports` in `.oxfmtrc.json` to `false`.
- `policy/typescript/base/bundle.json`: scripts, dependencies, and migration rules. Review migration rules: they declare old files and dependencies to remove.
- `policy/typescript/integrations/` and `policy/typescript/automation/`: optional settings, workflows, and hooks. Each option has a `bundle.json` declaration and can have a `files/` directory.

### Script contributions

A script string adds a command after earlier bundles' commands. To replace one bundle's command without adding a second pass, use its stable identity:

```json
{
  "scripts": {
    "lint": {
      "command": "alternate-linter .",
      "replaces": "base"
    }
  }
}
```

`replaces` must name a selected bundle with an ordinary string command for that script: `base`, `integrations/<id>`, or `automation/<id>`. Replacement chains are not supported. The replacement keeps its target's position; other bundles' commands and existing user scripts remain intact. Identical replacements coalesce; missing targets and conflicting replacements fail before any writes. Deselecting the replacement bundle restores the target command.

Top-level `ignorePatterns` arrays compose in bundle order with exact duplicates removed, for both Oxlint and Oxfmt. Integrations can add exclusions without dropping the base exclusions.

Commit your changes to your fork on GitHub. No build or npm release is needed.

## 3. Run your fork

From the project you want to configure, in a terminal:

```sh
npx --yes 'YOUR-USERNAME/its-checks'
```

Select your options and review any proposed replacements or removals. Rerun after updating your policy; generated project settings can be replaced.

If a branch launch reuses cached code, run a specific commit with `'YOUR-USERNAME/its-checks#FULL-COMMIT-SHA'` instead.
