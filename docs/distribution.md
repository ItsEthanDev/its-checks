# Git-repository launch validation

Status: **minimal GitHub launch validated; remote fixture cleanup blocked by credential scope**. These findings address [issue #2](https://github.com/ItsEthanDev/its-checks/issues/2). The real installer is not packaged yet; use the [source-checkout quickstart](../README.md#quickstart).

## Evidence and scope

The throwaway probe, raw command results, fixture histories, and cleanup receipt are preserved on local branch `experiment/github-launch-probe`, commit `8d340cd6641b620fbd432a7be9343199121abb50`, under `experiments/github-launch-probe/`. This branch has not been pushed or merged into the product. The fixture Git bundles were verified, cloned, and checked at every tested revision before deletion was attempted.

Tested environment: Linux x64, Bun 1.4.0, Node 24.21.0, npm/npx 11.19.0, Git 2.55.0, POSIX shell. Bun compiled the minimal CLI once and ran its prebuilt JavaScript through a Bun shebang. npm/npx additionally used Node; Git was available throughout. This does not establish other runtime versions or platforms.

The operator authorized two disposable public GitHub repositories:

- `ItsEthanDev/its-checks-launch-probe-upstream`
- `ItsEthanDev/its-checks-launch-probe-fork`

Both had the same package name, binary name (`its-checks`), package version (`0.0.0`), and prebuilt executable, with different external policy files. The fork-shaped repository was independent, not a GitHub fork relationship. Each contained only `package.json`, `bin/cli.js`, and `policy/identity.json`: no runtime dependencies, TypeScript sources, lifecycle hooks, or workflows. A non-lifecycle `compile` command deliberately exited 97 if invoked.

A separate temporary consumer had its own manifest and decoy policy. Package launches used a separate HOME and npm/Bun package caches. Bunx also populated execution caches in the OS temporary directory; the ten directories observed being created by these runs were removed afterward, along with the fixture/package-cache tree. No global installation of `its-checks`, registry publication, product-main push, or deployment was performed.

## Remote observations

33 remote process invocations completed successfully: 16 npm/npx and 17 Bunx. All read the consumer's manifest, preserved its cwd, and loaded policy from the executed package, not the consumer's decoy policy. No additional consumer files were observed. Dedicated pinned npm and Bunx follow-ups also compared exact consumer entries, bytes, modes, and mtimes before and after launch; both remained unchanged.

| Probe | npm/npx 11.19.0 | Bunx 1.4.0 |
| --- | --- | --- |
| Full HTTPS Git spec at a full commit | Correct policy | Correct policy |
| GitHub shorthand | Correct policy | Correct policy |
| Switch repositories with identical package/bin names and versions | Correct upstream/fork policy | Correct upstream/fork policy |
| Unchanged `probe-v1` tag after later commits | Original v1 policy | Original v1 policy |
| Policy-only update via a new full commit reference | New policy; no compilation | New policy; no compilation |
| Warm branch/default reference after policy update | Observed the new policy | Reused stale policy |
| Consumer cwd and decoy policy | Preserved | Preserved |

npm observed both policy-only updates through warm branch/default references. Its `--prefer-online` branch probe also observed the first update. Bunx's warm `#main` and default references stayed on v2 after v3 was pushed; changing to the full v3 commit reference immediately loaded v3. No refresh interval or cache-clearing workaround was established. **Use a full commit reference, and change that reference to obtain updated policy.** Do not depend on mutable refs refreshing immediately.

The original local-Git stage also passed ten npm/npx probes. Bunx rejected both local `git+file` forms with `unrecognised dependency format`; this did not predict its successful GitHub/HTTPS behavior.

### Tested command forms

These are historical probe commands, not commands for the current product repository. The fixture repositories are disposable and must not become a distribution channel. Replace `<sha>` with one of the recorded full commit hashes:

```sh
npm exec --yes --package='git+https://github.com/ItsEthanDev/its-checks-launch-probe-upstream.git#<sha>' -- its-checks
npm exec --yes --package='github:ItsEthanDev/its-checks-launch-probe-upstream#<sha>' -- its-checks
npx --yes 'ItsEthanDev/its-checks-launch-probe-upstream#<sha>'
bun x --package 'git+https://github.com/ItsEthanDev/its-checks-launch-probe-upstream.git#<sha>' its-checks
bun x --package 'github:ItsEthanDev/its-checks-launch-probe-upstream#<sha>' its-checks
```

Equivalent full-HTTPS forms using the fork URL and fork commit worked with both launchers. Direct inferred-bin npx and Bunx full-HTTPS calls also worked. Explicit package/bin forms avoid relying on binary inference.

| Fixture | Full commit | Policy marker |
| --- | --- | --- |
| upstream, `probe-v1` | `63a774917a2c98914eeae98da3ad1896a33f9c0a` | upstream-v1 |
| upstream, policy-only update | `f888217f7a994cc6d982556cbf8955a5e805e801` | upstream-v2 |
| upstream, second policy-only update | `854d1a57e195852a3011e4d6c63f1a4e4910d0ea` | upstream-v3 |
| fork, `probe-v1` | `ee43d4ad5008c0908d723c74f964ab437f94999c` | fork-v1 |

The executable's SHA-256 was `9b65e4c741d43247e9b2e79e500148fdf6096b2ed9c781fbd35777deaedafb19` at every remote fixture revision. Both upstream updates changed only `policy/identity.json`. Git source pinning does not by itself pin transitive registry dependencies; this probe intentionally had none.

## Distribution and freshness decision

Use committed, prebuilt JavaScript with external policy, a package `bin` entry, and an explicit `files` inclusion list. Retain Bun 1.4.0 as the runtime prerequisite. Forks can keep the same package/bin names and change the Git URL and commit reference; no fork registry publication is required.

Compile only through an explicit maintainer command such as `compile`. Do not add automatic Git-install compilation via `build`, `prepare`, `prepack`, or install hooks. The successful probes had no build inputs in the installed package and never invoked their deliberately failing `compile` command.

When integrating this decision into the real installer:

1. Bundle its runtime JavaScript dependencies and ship required policy/schema assets, without compiling policy into the executable.
2. Add a generated-output verification command that regenerates from source with the pinned Bun compiler, from a fixed repository root, and compares the checked-in executable. Run that check with the project's verification suite, not as a Git-install hook.
3. Keep policy-only edits out of compiler inputs so they need no rebuild.
4. Check the real package contents and run the compiled installer through its interactive workflow before changing the quickstart or claiming product distribution support.

This is the selected packaging strategy, not a claim that the full installer bundle or freshness check has been implemented. pnpm/Yarn launchers, arbitrary dependency graphs, hosted CI, Windows/macOS, publication, and deployment remain unverified or outside this experiment.

## Cleanup blocker

Both `gh repo delete ... --yes` attempts returned HTTP 403. GitHub reported that the current credential needs the `delete_repo` scope; subsequent read-only checks confirmed that both public fixture repositories still exist. No credential escalation was attempted.

The operator can run `gh auth refresh -h github.com -s delete_repo`, then have the agent retry the two already-authorized deletions, or delete those two repositories manually. The fixture contents and histories are already archived locally. Do not describe remote cleanup as complete until absence is verified.

## Primary sources

- [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec): explicit `--package`, binary inference, cache installation, and online/offline preferences. Mutable-ref behavior above is measured, not inferred from this page.
- [npm Git package specs](https://docs.npmjs.com/cli/v11/using-npm/package-spec#git-urls): Git URLs, refs, and GitHub shorthand.
- [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#git-urls-as-dependencies): Git dependency build triggers, executable links, and packed assets.
- [Bunx](https://bun.com/docs/pm/bunx) and [bun add](https://bun.com/docs/pm/cli/add): launcher and dependency-installation interfaces are distinct. The GitHub launcher support claimed here comes from the remote probes, not from assuming every install spec works in Bunx.
