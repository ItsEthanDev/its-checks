# its-checks

CLI that initializes and maintains project-selected code-quality tooling and conventions from GitHub policy repositories.

## Requirements

Node.js 22 or newer (including npm), Git, and the target project's package manager (npm, pnpm, Yarn, or Bun) on `PATH`.

Application runs the project's normal package-manager `install`, including lifecycle scripts and reruns with no configuration changes. The package manager owns dependency resolution and installation.

## Add policy sources

From the target directory containing `package.json`, in a terminal:

```sh
npx --yes 'ItsEthanDev/its-checks' add ItsEthanDev/its-checks
npx --yes 'ItsEthanDev/its-checks' add another/policies
```

The first repository reference selects the executable; the `add` argument selects a policy source. They need not be the same repository. GitHub-based executable distribution remains supported; npm publication and the rename are deferred.

Choose bundles with Space and Enter. Sources contain ordinary bundles under `policy/`, with no mandatory baseline. Required bundles are included automatically and explained before application. Review the combined plan and approve it before any project changes or installation.

Setup saves source identities, exact policy commits, explicit bundle selections, and non-secret answers in `.its-checks.json`. Commit this file for pinned reruns. Old selection files are unsupported; delete an old-format file and initialize afresh. Deleting state is not an uninstall and does not remove previously generated files.

## Rerun, update, or remove

```sh
# Edit selections across saved sources, using saved policy commits.
npx --yes 'ItsEthanDev/its-checks'

# Review an update to one source or all sources.
npx --yes 'ItsEthanDev/its-checks' update author/policies
npx --yes 'ItsEthanDev/its-checks' update

# Review removal of a source and its managed contributions.
npx --yes 'ItsEthanDev/its-checks' remove author/policies
```

Running without configured sources explains how to add one; it does not select a default policy. Updating the executable does not update saved policy commits. For an immutable executable revision, append `#<full-commit-sha>` to the executable repository reference.

Sources are cached by repository and commit under `$XDG_CACHE_HOME/its-checks/policies` (default `~/.cache/its-checks/policies`). Pinned reruns use cached content or fetch that exact commit, never a newer substitute. Installation may still need network access.

Policy declares ownership explicitly: seeded files are created only if absent and left behind on removal; composed fields are managed within their declared scope; replacement files are managed in full and proposed for deletion on removal. Direct edits within managed content may be overwritten. Inspect the Git diff and restore exceptions as needed. No override file or edit tracking is required.

Application is not transactional. Failures leave completed changes in place and report partial state. Source pins and answers are saved only after configuration and dependency installation succeed. Inspect failures and build a fresh plan before retrying.

For unattended use, see [headless setup](docs/headless.md). For policy authoring, see [customize policy](docs/customize-policy.md).

## Set up with an AI agent

Give your agent the source repositories to use and this workflow:

1. Read this README and `docs/headless.md`.
2. Discover each source through `options <owner/repo> --json` and use its returned exact commit.
3. Inspect the project, explain suitable bundles and automation, and ask for selections and inputs that cannot be inferred. Do not supply secrets as answers.
4. Create and review a combined plan, then apply the approved artifact.
5. Ask before running installed formatters or lint fixes against project code.

## Develop

Bun is the development package manager:

```sh
bun install --frozen-lockfile --ignore-scripts
node /absolute/path/to/its-checks/bin/its-checks.js add author/policies
```

No build is needed. `src/cli.ts` dispatches to six modules under `src/modules/`:

- `policy`: source fetching/cache, declarations, dependency graphs, inputs, and saved intent.
- `planning`: file/package composition, conflict detection, cleanup, and target snapshots.
- `application`: exact approved-plan application and package-manager operations.
- `setup`: interactive workflow and shared multi-source planning coordination.
- `terminal`: prompts and presentation.
- `headless`: discovery, configuration, saved plans, and noninteractive commands.

Module-root files are public entry points. Implementation lives in `lib/`, with module-owned tests in `tests/`. Cross-module callers and tests use public entry points, never another module's internals or test helpers. Module tests are excluded from installed packages and generator fingerprints. Executable fingerprints exclude policy content because policy revisions are independent.

The authored `policy/` remains a normal source repository alongside the implementation; it does not provide a built-in default. Local uncommitted policy edits do not affect fetched policy revisions. Follow [project standards](STANDARDS.md) and [testing guidance](docs/testing.md).
