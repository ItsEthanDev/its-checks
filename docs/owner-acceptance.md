# Independent owner policy-editing acceptance

**Pending: no human acceptance is recorded.** Automated policy-editing checks are not a substitute. Complete this pass yourself before accepting #11; use only policy files and the source CLI, not installer internals. The application recovery correction and automated regression are complete; this independent editing pass remains outstanding.

## Prepare and apply

With repository development dependencies installed and the [tested npm version](package-managers.md) available:

```sh
CHECKOUT="$PWD"
TARGET="$(mktemp -d /tmp/its-checks-owner-XXXXXX)"
cp -R examples/tailwind/. "$TARGET/"
git -C "$TARGET" init --quiet
cd "$TARGET"
node "$CHECKOUT/src/cli.ts"
```

Select Tailwind and, if desired, both automation options. Enter `src/styles.css` for both stylesheet questions. Inspect the displayed plan, approve changes when asked, then run:

```sh
node --run format
node --run check
```

Expect both commands to exit zero. Inspect standalone `.oxfmtrc.json`/`.oxlintrc.json`, generated manifest scripts/dependencies, saved answers, and any selected native hook/workflow files. Review normal install/lifecycle effects; do not publish or run Actions for this pass.

## Independently change both bundles

1. In the checkout, change a baseline formatting opinion in `policy/typescript/base/files/.oxfmtrc.json` (for example `semi: false`).
2. Independently change integration lint policy in `policy/typescript/integrations/tailwind/files/.oxlintrc.json` (for example add `"tailwindcss/no-arbitrary-value": "error"`). Do not edit `src/` or rebuild anything.
3. Rerun the same CLI from `$TARGET`, retaining Tailwind and the saved paths. Inspect the replacement plan before approving. Confirm both edits reached the generated files.
4. Run `node --run format`; confirm the chosen baseline style appears in `src/card.tsx`. Temporarily add `w-[13px]` to its class string; `node --run lint` should fail with the new Tailwind rule. Remove that class, then run `node --run format` and `node --run check` successfully.
5. Rerun the CLI with matching selections/answers. Expect no changes and no dependency installation. If automation was selected, inspect its common command and preserved marker/block; no commit or remote workflow is needed.

Revert only your deliberate policy edits afterward if they are not intended final opinions. Keep or remove your disposable target yourself. Do not reset unrelated checkout changes.

## Record the result yourself

Record the actual checkout revision (`git rev-parse HEAD`, plus whether policy had uncommitted edits), target/runtime/manager versions, both edits, observed generated results and command exit statuses. State **accepted** or describe the exact confusing step or missing capability. Do not mark acceptance based only on an agent's test output. No record has been prefilled on your behalf.

Known limits to evaluate: the same stylesheet is asked twice because inputs bind one destination; native automation commands are edited in their own files; metadata pins the schema revision, not the executing checkout; current-known deselection cannot clean renamed historical files/scripts; retiring Husky may require manual cleanup of its Git config/dispatch directory. See [fork-author guidance](fork-author.md) and [compatibility limits](policy-compatibility.md).
