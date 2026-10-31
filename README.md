# its-checks

Apply editable, standalone TypeScript formatting and linting policy to one package. Oxfmt and Oxlint are prescribed; Tailwind CSS v4, Husky pre-commit checks, and GitHub Actions are optional.

## Run from source

Requires Node 24+ and a [tested target package manager](docs/package-managers.md). From the package containing the `package.json` you want to change:

```sh
node /absolute/path/to/its-checks/src/cli.ts
```

Run in a terminal. Select integrations and automation with Space, then Enter. Review the plan before confirming replacements/removals. Tailwind asks for the same existing stylesheet path twice, once for each tool. Configuration and intended selections are saved before normal dependency installation; lifecycle scripts run. Inspect existing project scripts and dependencies first. Failures can leave partial changes; no rollback is promised.

The checkout needs its own dependencies installed. For development:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
npm run test:policy
```

The last command downloads policy dependencies into temporary projects, audits their install hooks with scripts disabled, then performs normal npm adapter installations and executes Oxc and local Husky hooks. It does not run Actions, commit, or publish anything.

## Everyday project commands

| Command | Behavior |
| --- | --- |
| `node --run check` | Check formatting, then lint; stop on failure |
| `node --run format:check` | Check formatting |
| `node --run format` | Write formatting changes |
| `node --run lint` | Lint; warnings fail |
| `node --run lint:fix` | Apply safe lint fixes; remaining diagnostics fail |

The target manager's ordinary `run <name>` also works. Generated wrappers preserve existing public commands and invoke reserved `its-checks:` helpers. Husky checks the entire package without fixing or staging files. GitHub Actions uses the same `check` command and requires an exact supported `packageManager` declaration and committed lockfile.

## Change the opinions

Edit [`policy/`](policy/), not installer code. See the [fork-author guide](docs/fork-author.md), [released compatibility evidence and limits](docs/policy-compatibility.md), and [independent owner acceptance procedure](docs/owner-acceptance.md). Representative packages are under [`examples/`](examples/).

**Release gates remain:** the owner has not performed the independent editing pass; the pinned schema's remote availability is not established; Git-reference distribution/compiled packaging is deferred to #2. No package-manager download command or published executable is claimed. The source CLI and editable policy require no build step.
