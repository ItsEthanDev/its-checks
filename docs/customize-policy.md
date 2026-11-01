# Use your own policy

## 1. Fork

On GitHub, open [ItsEthanDev/its-checks](https://github.com/ItsEthanDev/its-checks) and click **Fork** to create your own copy.

In your fork's `policy/bundle.json`, change `source.repository` to your fork's URL, such as `https://github.com/YOUR-USERNAME/its-checks`.

## 2. Edit your preferences

Edit files in your fork, using GitHub's editor or a local checkout:

- `policy/typescript/base/files/`: default formatter and linter settings. For example, change `sortImports` in `.oxfmtrc.json` to `false`.
- `policy/typescript/base/bundle.json`: scripts, dependencies, and migration rules. Review migration rules: they declare old files and dependencies to remove.
- `policy/typescript/integrations/` and `policy/typescript/automation/`: optional settings, workflows, and hooks. Each option has a `bundle.json` declaration and can have a `files/` directory.

Commit your changes to your fork on GitHub. No build or npm release is needed.

## 3. Run your fork

From the project you want to configure, in a terminal:

```sh
npx --yes 'YOUR-USERNAME/its-checks'
```

Select your options and review any proposed replacements or removals. Rerun after updating your policy; generated project settings can be replaced.

If a branch launch reuses cached code, run a specific commit with `'YOUR-USERNAME/its-checks#FULL-COMMIT-SHA'` instead.
