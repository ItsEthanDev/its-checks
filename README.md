# its-checks

Apply editable, standalone Oxfmt and Oxlint policy to one TypeScript package. Tailwind CSS v4, Convex lint rules, Husky pre-commit checks, and GitHub Actions are optional.

## Quickstart

A source checkout is required. Install Node **24+**, npm for the checkout dependencies, and an exact [supported target package manager](docs/package-managers.md). No build step is needed.

```sh
cd /path/to/its-checks
npm ci --ignore-scripts --no-audit --no-fund
cd /path/to/target-package
node /absolute/path/to/its-checks/src/cli.ts
```

Run directly in a terminal from the directory containing the target `package.json`. Use Space to select options and Enter to continue. Review the plan before approving replacements or removals. Setup runs normal dependency installation, including lifecycle scripts; failures can leave partial changes.

After setup, run `node --run fmt` to format or `node --run check` to check formatting and lint. Package-key sorting can cause rerun churn; see [known limitations](docs/usage.md#known-limitations).

- [Usage](docs/usage.md): setup, daily commands, reruns, conflicts, and recovery.
- [Policy reference](docs/policy.md): edit opinions, add bundles, declare inputs, and manage cleanup.
- [Package managers](docs/package-managers.md): exact versions, required settings, and retry limits.
