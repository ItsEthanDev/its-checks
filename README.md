# its-checks

CLI that sets up formatting and linting in TypeScript projects, with optional integrations and automation.

## Requirements

Node.js 22 or newer (including npm) and Git on `PATH`.

Install the target project's package manager (npm, pnpm, Yarn, or Bun) on `PATH`. Setup uses the project's existing package-manager configuration.

After applying configuration, setup runs the selected manager's normal `install`, including on reruns with no configuration changes. The package manager owns dependency resolution and installation.

## Run

From the target directory containing `package.json`, in a terminal:

```sh
npx --yes 'ItsEthanDev/its-checks'
```

Use Space to select options and Enter to continue. Default-branch launches can reuse cached code; append `#<full-commit-sha>` to the repository reference to choose an immutable revision. Replace the repository reference to use a fork.

For a local checkout, run `npm install --omit=dev --ignore-scripts` there, then run this from the target directory:

```sh
node /absolute/path/to/its-checks/bin/its-checks.js
```

Review the generated package scripts for the commands supplied by your selected policy.

Setup generates `.its-checks.json` in the target project to save your selections, answers, and source identity. Keep it for reruns: setup uses it to prefill choices and clean up deselected integrations and automation.

For agents and unattended setup, see [headless usage](docs/headless.md).

## Customize

[Fork this repository and customize its policies](docs/customize-policy.md) to use your own formatting, linting, and automation preferences.

## Develop

Bun is this repository's development package manager. Install dependencies with `bun install --frozen-lockfile --ignore-scripts`.

Edit the executed checkout's `policy/` declarations and native files, then rerun setup; no build is needed. Generated target configuration can be replaced on rerun. Implementation is in [`src/`](src/); the Node launcher uses `tsx` to run it directly.

Follow the [project standards](STANDARDS.md) and [testing guidance](docs/testing.md).
