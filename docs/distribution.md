# Launch and distribution

`its-checks` ships TypeScript source, external `policy/` files, and schemas. Its package executable points directly to `src/cli.ts`, which runs with Bun. There is no prebuilt executable, generated-code freshness check, install-time compiler, or runtime revision-pinning launcher.

## Default branch and caching

From a target package directory:

```sh
npx --yes 'ItsEthanDev/its-checks'
```

The explicit package/bin form is:

```sh
npm exec --yes --package='github:ItsEthanDev/its-checks' -- its-checks
```

These commands request the repository's default branch. No documentation edit is needed when the code or policy changes. npm/npx installs the installer's runtime dependencies in its own cache; the target package manager remains an independent choice.

A default-branch URL is a convenience, not a promise that every invocation fetches the newest code. Launchers can reuse cached source and policy. In the minimal GitHub experiment, npm observed policy updates through warm branch/default references, while Bunx reused stale policy. `--prefer-online` asks npm to check freshness but is not a cross-launcher guarantee that every cached installation is refreshed.

If an exact revision matters, use a commit reference. Otherwise accept the launcher's cache behavior or use a freshly updated checkout. Setup does not resolve today's HEAD and mislabel cached code as that revision, nor save an automatic project pin.

## Choose a specific commit

Copy a commit's full SHA from GitHub's commit page and substitute it below:

```sh
npx --yes 'ItsEthanDev/its-checks#<full-commit-sha>'
```

The placeholder is intentional: the user selects the revision. Documentation does not contain a recommended SHA that must change whenever documentation or code is committed.

Repeating the same pinned command uses that revision's source and policy; changing the SHA selects another revision. Cached copies are suitable when the requested revision is immutable. A commit reference pins repository contents, not the entire transitive runtime dependency graph or proof of successful target installation.

## Forks and Bunx

For a fork, change the repository reference, not the package or executable name:

```sh
npx --yes 'YOUR-ACCOUNT/YOUR-FORK'
npx --yes 'YOUR-ACCOUNT/YOUR-FORK#<full-commit-sha>'
```

Bunx GitHub launch forms also worked in the minimal probe:

```sh
bun x --package 'github:ItsEthanDev/its-checks' its-checks
bun x --package 'github:ItsEthanDev/its-checks#<full-commit-sha>' its-checks
```

Bunx's warm default/branch references did not pick up a policy-only update during the experiment. A new full commit reference did. Do not infer GitHub support from local `git+file` support: Bunx rejected the latter in the probe. pnpm/Yarn launchers are not verified; their support as target package managers is separate.

## Runtime and package contract

The tested environment is Linux x64, Bun 1.4.0, Node 24.21.0, npm/npx 11.19.0, Git 2.55.0, and POSIX shell. Bun must be available on `PATH`, even when npm/npx launches the tool. npm/npx itself uses Node; target commands retain their [manager/runtime requirements](package-managers.md#supported-environments).

The package includes `src/`, `policy/`, and `schemas/`, plus package metadata and the README. Runtime libraries remain normal dependencies. Development dependencies, tests, and the source checkout are not needed to run the installed CLI. No `build`, `prepare`, `prepack`, or install hook compiles the installer.

Policy lookup is relative to the executed package. Project operations use the caller's working directory. The CLI remains interactive-only and retains exact approved-plan safeguards and native dependency-state assessment. Packaging does not authorize unattended operation or change target lifecycle behavior.

## Verification and limits

`bun run test:package` packs the real package with Bun, checks shipped files including policy dotfiles and schemas, installs it into an isolated consumer with production dependencies only, and runs the CLI through its installed executable. Interactive behavior uses fixed test-owned policy, not assertions about editable root policy opinions. It covers setup, matching reruns, declined conflicts, cancellation, invalid intent, noninteractive refusal, and policy-only edits without changing the entrypoint.

The source CLI uses the same PTY suite through `bun run test:cli`. Unit, typecheck, real-manager, and reference tool-compatibility suites remain separate checks. No prebuilt-artifact generation or comparison is required.

The earlier minimal GitHub experiment recorded 33 successful process invocations (16 npm/npx, 17 Bunx), distinct upstream/fork policy with identical package/bin names, commit/tag selection, policy-only updates, cache limits, and exact target-state preservation. Its code, raw outputs, and complete fixture Git bundles are retained on local branch `experiment/github-launch-probe` under `experiments/github-launch-probe/`. Those results establish launcher behavior, not a full source-package GitHub smoke test; that check follows the source package's first push.

Other platforms, launcher versions, hosted CI, Convex policy compatibility, and general dependency-graph combinations remain unverified. This distribution path does not require registry publication or deployment.

## Disposable fixture cleanup

The minimal experiment used `ItsEthanDev/its-checks-launch-probe-upstream` and `ItsEthanDev/its-checks-launch-probe-fork`. Agent deletion attempts were rejected because the credential lacked `delete_repo`. The owner chose to delete them manually; their histories were archived first. They are not product distribution channels. Local fixture trees and experiment-created caches were removed.

## Primary sources

- [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec): explicit `--package`, binary inference, and cache preferences.
- [npm Git package specs](https://docs.npmjs.com/cli/v11/using-npm/package-spec#git-urls): default branches, Git URLs, refs, and GitHub shorthand.
- [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#git-urls-as-dependencies): executable links, packed assets, and Git dependency build triggers.
- [Bun TypeScript](https://bun.com/docs/runtime/typescript) and [Bunx](https://bun.com/docs/pm/bunx): runtime and launcher interfaces. Measured cache behavior is reported above rather than inferred from installation support.
