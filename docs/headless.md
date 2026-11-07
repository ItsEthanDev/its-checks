# Headless setup

Run from the target directory containing `package.json`. No terminal or prompts are needed.

## Discover exact policy revisions

```sh
npx --yes 'ItsEthanDev/its-checks' options author/policies --json
```

The result contains the canonical repository identity, resolved commit, and bundle IDs, descriptions, visibility, dependencies, and input declarations. Repeat for each source. Hidden bundles are dependency-only and cannot be explicitly selected.

## Declare selections and answers

Create `setup.json` using the [setup configuration schema](../schemas/setup.schema.json) and the full commit returned by discovery:

```json
{
  "schemaVersion": 2,
  "sources": [
    {
      "repository": "author/policies",
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "bundles": ["typescript"],
      "answers": {}
    }
  ],
  "packageManager": "npm"
}
```

The commit above is illustrative; replace it with the discovered commit. Add another source object to mix repositories. Repository identities must be lowercase and unique. Empty bundle arrays mean no explicit selections; there is no implicit baseline. Dependencies are resolved within each source's pinned revision.

Answers are source-local maps of bundle ID to input ID to typed value, for example `"answers": {"styles": {"stylesheet": "src/app.css"}}`. Supply every input for selected bundles and dependencies, including inputs with defaults. Unknown, deselected, missing, or invalid answers fail planning. Answers and plans are not secret storage.

You can use new-format `.its-checks.json` directly as the config. Add `packageManager` to a separate config if manager detection is ambiguous; otherwise it is optional. Supported values are `npm`, `pnpm`, `yarn`, and `bun`.

## Review and apply one combined plan

```sh
npx --yes 'ItsEthanDev/its-checks' plan --config /tmp/setup.json --out /tmp/setup.plan.json
npx --yes 'ItsEthanDev/its-checks' apply /tmp/setup.plan.json --json
```

Planning writes only the plan artifact, which must not already exist. Source fetching may populate the CLI cache; it does not modify the target. The plan combines all sources, their exact revisions, resolved answers, dependency explanations in file reasons, and proposed changes. Conflicts or unresolved selections block the entire plan.

Relative paths resolve from the current directory; config/output locations do not select the target. Plans record the target's absolute path, so apply may run elsewhere.

Plans are local, short-lived artifacts containing exact file contents. Review them and do not apply untrusted plans. Changed observed target files or executable runtime require a fresh plan. Pin both executable invocations to the same `ItsEthanDev/its-checks#<full-commit-sha>` if needed. Policy commits are separately pinned in the config. Apply does not fetch newer policy.

Application writes configuration and cleanup, runs normal package-manager installation including lifecycle scripts, then saves the new intent and pins. It does not freeze package dependency resolution. Failures retain completed work without rollback and do not advance intent before successful installation; inspect the report and create a fresh plan to retry.

For headless updates, discover new commits and replace the intended source commits in the config. Preserve or explicitly revise bundle selections; removed or dependency-only selected IDs fail rather than silently disappear. To remove a source, omit it from the config; cleanup uses the previous saved source revisions. Never delete seeded project content as part of this cleanup.

Add `--json` to commands for JSON results on stdout and structured errors on stderr. Application reports list completed and incomplete operations, including `install-dependencies`. The `dependencyWork` field is `not-started` before installation, `started` when installation fails, or `completed` after success; installation is never skipped after successful configuration. Successful reports include saved bundle completion notes in `notes`, with `bundle`, `name`, and original `message` text for each entry; failed or declined reports have an empty list. Without `--json`, completion notes appear in titled boxes after the summary. See [completion notes](customize-policy.md#completion-notes) for authoring and display behavior. Exit codes are 0 for success and 1 for failure. Interactive add/update/remove operations require a terminal.
