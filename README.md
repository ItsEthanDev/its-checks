# its-checks

Beta setup for standalone Oxfmt and Oxlint configuration in one TypeScript package. Optional integrations and automation live in [`policy/`](policy/).

## Requirements

Bun 1.4.0, Node 24+, and Git on `PATH`. Tested on Linux x64 with POSIX shell. Install the target package manager separately:

Install the target project's package manager (npm, pnpm, Yarn, or Bun) on `PATH`. Setup uses the project's existing package-manager configuration without requiring a particular version, linker, or lockfile format.

After applying configuration, setup runs the selected manager's normal `install`, including on reruns with no configuration changes. The package manager owns dependency resolution and installation; setup does not audit or repair its internal state.

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

Setup generates `.its-checks.json` in the target project to save your selections, answers, and source identity. Keep it for reruns: setup uses it to prefill choices and clean up deselected integrations and automation. It does not record installation success or pin future launches. Its format is defined in [`schemas/its-checks.schema.json`](schemas/its-checks.schema.json).

## Safety

Commit or back up the target first. Review replacements and removals. Installation runs project lifecycle scripts; changes are not transactional and there is no automatic rollback. Fix failures and rerun. Do not edit the target concurrently with setup.

`.its-checks.json` saves choices and source identity, not installation success or a pin for future launches. Keep it for reruns and cleanup. Its format is defined in [`schemas/its-checks.schema.json`](schemas/its-checks.schema.json).

Known Tailwind tooling risk: [minimatch denial of service](https://github.com/advisories/GHSA-g3hv-75wg-m249). Exploit reachability through the configured tools is unverified; audit the target tooling separately from the installer.

## Develop

Edit the executed checkout's `policy/` declarations and native files, then rerun setup; no build is needed. Generated target configuration can be replaced on rerun. Implementation is in [`src/`](src/); examples are in `policy/` and tests.

Run checks with `bun run`: `test`, `typecheck`, `test:managers`, `test:policy`, `test:cli`, and `test:package`.
