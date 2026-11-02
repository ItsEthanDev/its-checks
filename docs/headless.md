# Headless setup

Run from the target directory containing `package.json`. No terminal or prompts are needed.

Discover available selections and inputs:

```sh
bunx ItsEthanDev/its-checks options --json
```

Create `setup.json` with explicit selections and answers:

```json
{
  "integrations": [],
  "automation": [],
  "answers": {}
}
```

Use IDs from `options`. Supply every input declared by the baseline and selected bundles, including inputs with defaults. Answers are grouped by bundle key, then input ID: `{"base":{"input-id":"value"}}`. Preserve the declared value types. Empty selection arrays mean "none". You can also use an existing `.its-checks.json` as the config.

If package-manager detection is ambiguous, add `"packageManager": "npm"` (or `pnpm`, `yarn`, `bun`) to the config.

Preview and save a plan, then apply it:

```sh
bunx ItsEthanDev/its-checks plan --config /tmp/setup.json --out /tmp/setup.plan.json
bunx ItsEthanDev/its-checks apply /tmp/setup.plan.json --json
```

Planning writes only the plan file, which must not already exist. Relative paths resolve from your current directory; config and output locations do not choose the target project. The plan records the target's absolute path, so apply can run from another directory.

Plans are local, short-lived artifacts containing exact file contents. Review them before applying; do not apply untrusted plans. Changed observed target files or generator code/policy require a fresh plan. Pin both invocations to the same revision with `ItsEthanDev/its-checks#<full-commit-sha>`.

Apply writes configuration, then runs the selected manager's normal `install`, including lifecycle scripts. Dependency resolution is not frozen by the plan. Failures leave completed work in place; inspect the error report before retrying.

Add `--json` to any command for JSON results on stdout and structured errors on stderr. Exit codes are 0 for success and 1 for failure.
