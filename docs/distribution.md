# Git-repository launch validation

Status: **local Git feasibility passed; GitHub execution remains unverified**. This is the first stage of [issue #2](https://github.com/ItsEthanDev/its-checks/issues/2), not a release or a replacement for the [source-checkout quickstart](../README.md#quickstart).

## Local evidence

The minimal probe is preserved on local branch `experiment/github-launch-probe`, commit `c7dd4eb25c5bfff41ad6d78e82705b19bd2bdc42`, under `experiments/github-launch-probe/`. That branch has not been pushed. Its README describes the experiment and its `verify.ts` reproduces the observations with Bun. It does not run or modify the installer.

Tested environment: Linux x64, Bun 1.4.0, Node 24.21.0, npm/npx 11.19.0, Git 2.55.0, POSIX shell. Bun compiled the probe once and ran its prebuilt JavaScript through a Bun shebang. npm/npx required Node and Git as launcher prerequisites.

Two temporary Git repositories had identical package name, binary name, version, and compiled executable, but different external policy files. A separate consumer had its own decoy policy. Both repositories had no runtime dependencies or lifecycle hooks. Their non-lifecycle `compile` script deliberately failed if invoked. Caches and HOME were isolated; all temporary repositories, installations, and caches were removed afterward.

| Probe | Observed result |
| --- | --- |
| npm exec, full commit SHA | Correct repository policy and consumer cwd |
| npm exec, immutable tag | Original tagged policy |
| npx, inferred binary name | Same result as explicit npm exec |
| Switch repositories with identical package/bin names and versions | Each repository's own policy; no cross-repository cache mix-up |
| Policy-only commit, unchanged executable | New policy with no compilation |
| Warm `#main` after the policy commit | New policy, normally and with `--prefer-online` |
| New full commit SHA, then old tag | New policy, then original policy |
| Consumer after all launches | No dependency, lockfile, manifest, or policy writes |
| Bunx, local `git+file` spec, direct and explicit-package forms | Both rejected with `unrecognised dependency format` |

All ten npm/npx invocations passed. The two Bunx failures establish only a limitation of the tested local URL forms; GitHub/HTTPS Bunx launch remains unverified.

The tested local command forms are:

```sh
npm exec --yes --package='git+file:///absolute/upstream#<full-commit-sha>' -- its-checks
npm exec --yes --package='git+file:///absolute/upstream#probe-v1' -- its-checks
npm exec --yes --package='git+file:///absolute/upstream#main' -- its-checks
npx --yes 'git+file:///absolute/upstream#<full-commit-sha>'
```

These are probe commands, not working commands for the current product repository. The product does not yet declare a packaged binary.

## Packaging direction to validate remotely

Use committed, prebuilt JavaScript with external policy, a package `bin` entry, and an explicit `files` inclusion list. Keep the current Bun runtime prerequisite unless a separate runtime change is validated. Avoid automatic Git-install compilation: use an explicit maintainer command such as `compile`, rather than `build`, `prepare`, `prepack`, or install hooks.

When integrating the real installer, add a source-to-generated-output check so source changes cannot leave a stale executable. Policy-only changes must not require rebuilding. The minimal probe establishes relative policy lookup and launch behavior, not that a complete installer bundle or its native assets are packaged correctly.

Prefer full commit references for reproducible source selection and policy updates. The local moving-branch refresh observation does not establish GitHub cache behavior, immutable dependencies, or a refresh interval. No global tool installation or registry publication was required.

## Remaining remote validation

Repeat the probe against two distinct public GitHub fixture repositories with the same package/bin names: an upstream-shaped repository and a fork-shaped repository. Test full HTTPS Git specs, GitHub shorthand, pinned commits/tags, moving refs with warm caches, and a policy-only commit with an unchanged executable. Capture successful commands and unsupported forms separately.

Creating and populating fixture repositories needs permission separate from pushing normal project code to `ItsEthanDev/its-checks:main`. The product GitHub repository was empty when inspected. No remote writes have been performed for this experiment.

Do not close #2 based on local results. GitHub execution, the final full-installer bundle/freshness check, pnpm/Yarn launchers, other platforms, publication, and deployment remain unverified or outside this stage.

## Primary-source constraints

- [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec) documents explicit `--package`, binary inference, cache installation, and online/offline preferences. Git mutable-ref refresh timing still needs measurement.
- [npm Git package specs](https://docs.npmjs.com/cli/v11/using-npm/package-spec#git-urls) document Git URLs and refs, including GitHub shorthand. Combining these with npm exec is the candidate remote launch path.
- [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#git-urls-as-dependencies) documents Git dependency build triggers: workspaces and scripts named `build`, `prepare`, `prepack`, `preinstall`, `install`, or `postinstall`. Its `bin` and `files` sections define executable links and packed assets.
- [Bunx](https://bun.com/docs/pm/bunx) documents npm-package execution and `--package`, not a guarantee that every Git spec accepted by [bun add](https://bun.com/docs/pm/cli/add) works as a launcher. Do not infer launcher support from target-project manager support.
