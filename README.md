# its-checks

Apply editable, standalone Oxfmt and Oxlint policy to one TypeScript package. Tailwind CSS v4, Convex lint rules, Husky pre-commit checks, and GitHub Actions are optional.

## Quickstart

Install **Bun 1.4.0** for the installer runtime, plus an exact [supported target package manager](docs/package-managers.md) on `PATH`. The supplied target policy uses Node **24+** commands; npm, pnpm, and Yarn also require Node. The npm/npx launcher additionally needs npm and Git. Bun does not replace those target requirements.

From the target package directory, run:

```sh
npx --yes 'ItsEthanDev/its-checks'
```

This requests the repository's default branch. It runs TypeScript directly with Bun: no prebuilt executable, build hook, global `its-checks` installation, or registry publication is needed. The launcher installs the tool's runtime dependencies in its cache, separately from your target's dependencies.

**Default-branch launches can reuse cached code and policy.** For a reproducible revision, use the [optional commit-pinned form](docs/distribution.md#choose-a-specific-commit). Pinning is your operational choice; documentation does not prescribe a particular commit.

Run directly in a terminal from the directory containing the target `package.json`. Use Space to select options and Enter to continue. Review the plan before approving replacements or removals. Setup runs normal target dependency installation, including lifecycle scripts; failures can leave partial changes.

After setup, run `node --run fmt` to format or `node --run check` to check formatting and lint. Formatting-only manifest edits, including native package-key sorting, do not request reinstallation.

## Run from a checkout

For local development or policy editing:

```sh
cd /path/to/its-checks
bun install --frozen-lockfile --ignore-scripts
cd /path/to/target-package
bun /absolute/path/to/its-checks/src/cli.ts
```

No build step is needed. Policy comes from the executed package or checkout, never the target directory.

- [Usage](docs/usage.md): setup, daily commands, reruns, conflicts, and recovery.
- [Launch and distribution](docs/distribution.md): forks, optional commit pinning, caching, and verification limits.
- [Policy reference](docs/policy.md): edit opinions, add bundles, declare inputs, and manage cleanup.
- [Package managers](docs/package-managers.md): exact versions, required settings, and retry limits.
