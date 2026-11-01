# its-checks

Beta setup for standalone Oxfmt and Oxlint configuration in one TypeScript package. Optional integrations and automation live in [`policy/`](policy/).

## Requirements

Bun 1.4.0, Node 24+, and Git on `PATH`. Tested on Linux x64 with POSIX shell. Install the target package manager separately:

| Manager | Version | Required settings |
| --- | --- | --- |
| npm | 11.19.0 | Lockfile v3; `node_modules` |
| pnpm | 12.9.0 | Isolated linker; `.npmrc`: `manage-package-manager-versions=false` |
| Yarn Classic | 1.22.22 | `node_modules`, not PnP |
| Bun | 1.4.0 | Text lockfile; `bunfig.toml`: `linker = "isolated"` under `[install]` |

Keep development dependencies and lifecycle scripts enabled.

## Run

From the target directory containing `package.json`, in a terminal:

```sh
npx --yes 'ItsEthanDev/its-checks'
```

Use Space to select options and Enter to continue. Default-branch launches can reuse cached code; append `#<full-commit-sha>` to the repository reference to choose an immutable revision. Replace the repository reference to use a fork.

For a local checkout, run `bun install --frozen-lockfile --ignore-scripts` there, then run this from the target directory:

```sh
bun /absolute/path/to/its-checks/src/cli.ts
```

After setup: `node --run fmt` to format; `node --run check` to check formatting and lint.

## Safety

Commit or back up the target first. Review replacements and removals. Installation runs project lifecycle scripts; changes are not transactional and there is no automatic rollback. Fix failures and rerun. Do not edit the target concurrently with setup.

`.its-checks.json` saves choices and source identity, not installation success or a pin for future launches. Keep it for reruns and cleanup. Its format is defined in [`schemas/its-checks.schema.json`](schemas/its-checks.schema.json).

Known Tailwind tooling risk: [minimatch denial of service](https://github.com/advisories/GHSA-g3hv-75wg-m249). Exploit reachability through the configured tools is unverified; audit the target tooling separately from the installer.

## Develop

Edit the executed checkout's `policy/` declarations and native files, then rerun setup; no build is needed. Generated target configuration can be replaced on rerun. Implementation is in [`src/`](src/); examples are in `policy/` and tests.

Run checks with `bun run`: `test`, `typecheck`, `test:managers`, `test:policy`, `test:cli`, and `test:package`.
