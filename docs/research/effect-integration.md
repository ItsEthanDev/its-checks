# Effect integration recommendation

Status: researched proposal; no policy integration or CLI change implemented.

## One configuration and one runner

Use the official `@effect/tsgo@0.63.0` integration. Its published support matrix includes the base policy's Oxlint `1.90.0` and `oxlint-tsgolint` `7.0.2005`. It supports Effect v3 and v4, with individual rules limited to versions they understand. The repository currently uses Effect `4.1.1`.[1]

`effect-tsgo oxlint` launches the installed Oxlint CLI with packaged Effect-enabled native components. It supports ordinary native rules, JavaScript plugins, and Effect rules together. The wrapper avoids patching `node_modules`, install lifecycle hooks, and changing the consumer's TypeScript installation. Its Oxlint path does not require installing TypeScript 7. Packaged Oxlint components do not support Linux musl.[1]

Add an Effect policy fragment to the existing `.oxlintrc.json`. Preserve the base categories, plugins, rules and selected integrations. Add the Effect schema, append `effecttsgo` to the root plugin list, and extend the published strict preset. The explicit plugin addition matters: the base already supplies a root plugin list, which otherwise overrides the preset's plugin list. Type-aware mode is already enabled by the base.[3]

Use these managed commands when Effect is selected:

```sh
effect-tsgo oxlint --deny-warnings .
effect-tsgo oxlint --fix --deny-warnings .
```

Keep stock `oxlint` when Effect is not selected. Stock Oxlint rejects the Effect plugin, so changing only the configuration is insufficient. Every entry point consuming that configuration, including the editor, must launch the Effect-enabled runner.

Do not add `@effect/eslint-plugin` for semantic checks. It exports only `dprint` and `no-import-from-barrel-package`; its formatter preset disables rules including `curly`, conflicting with this policy.[2] No additional formatter is needed.

## Generic CLI change: explicit contribution replacement

`src/scripts.ts` currently concatenates selected bundles' commands for each script. An integration cannot select a different runner for the base command; adding its own `lint` command would create a second lint pass, with stock Oxlint failing first against the combined config.

Retain ordinary additive script strings. Add one explicit way to replace a named bundle's contribution to the same script. Proposed syntax, **not currently accepted by the CLI**:

```json
{
  "scripts": {
    "lint": {
      "command": "effect-tsgo oxlint --deny-warnings .",
      "replaces": "base"
    },
    "lint:fix": {
      "command": "effect-tsgo oxlint --fix --deny-warnings .",
      "replaces": "base"
    }
  }
}
```

`base` is the existing bundle identity, not a tool name. Resolve replacements before command deduplication and substitute at the original contribution's position. Preserve unrelated selected-bundle contributions and existing user-authored shell commands. Missing replacement targets and competing different replacements must fail with source context, not select a winner by integration order. Deselecting Effect naturally restores the base commands by recomputing the selected contributions.

This keeps the CLI unaware of Effect, Oxlint, executable names, or command syntax. It needs neither shell parsing nor a tool registry. Existing user-owned commands that invoke stock Oxlint must also be updated explicitly; do not rewrite opaque user shell text automatically.

Install only the pinned development tool. Preserve the application's Effect runtime version. Do not replace its `tsconfig.json` or editor configuration. The base check already invokes the composed lint script, so no second `check` contribution is needed.

## Editor diagnostics: use the same Oxlint LSP

Oxlint `1.90.0` supports a language server. Configure Neovim's Oxlint client to launch the project-local wrapper from the project root:

```text
<project>/node_modules/.bin/effect-tsgo oxlint --lsp
```

Keep the existing TypeScript server for typechecking, completion, navigation and hovers. The Oxlint LSP provides both ordinary and Effect lint diagnostics from the same config as CI; no separate Effect TypeScript language server is required. Current nvim-lspconfig calls this server `oxlint`. Override its command and ensure type-aware mode is enabled rather than relying on availability heuristics.[6][7]

The wrapper resolves its underlying Oxlint packages from its working directory, so project-root execution matters.[1] In monorepos, choose the actual configuration/tool installation root deliberately. Do not assume an executable available globally has the correct version.

The disk-only nvim-lint adapter is a fallback for on-save diagnostics. Its current Oxlint adapter parses GitHub annotations, not JSON. The pinned CLI has no source-stdin mode: unsaved buffer support requires the LSP, not adding a stdin flag to the lint command.[8]

Effect's separate TypeScript language service offers additional Effect-specific hovers and refactors, but uses different diagnostic settings. If adopted alongside Oxlint, disable its duplicate Effect diagnostics as recommended by Effect's integration guide.[5]

## Rule selection

The **published 0.63.0** strict preset enables 91 Effect rules as errors. It covers floating Effects, missing error/service requirements, incorrect generator yielding, nested Effects/Promises, Layer composition mistakes, broad untyped errors, Schema mistakes, and idiomatic simplifications. Inherit the preset instead of copying its rules. Published presets and schema are the versioned authority; the inspected repository snapshot already contained additions absent from the published package.[3][4]

The combined config changes which additional rules are enabled automatically. Native rule metadata classifies Effect rules into ordinary Oxlint categories. The existing wholesale `correctness` and `suspicious` policy enables these three rules beyond strict:

- `effecttsgo/any-unknown-in-error-context`
- `effecttsgo/unsafe-effect-type-assertion`
- `effecttsgo/strict-effect-provide`

Do not add explicit entries for the first two: the categories already enable them. The unsafe-assertion rule also overlaps the base's generic unsafe-assertion check in the tested error/context-erasing cases. Keep wholesale category selection rather than restating their members.

Set **`effecttsgo/strict-effect-provide: off`** as a defended exception. It reports legitimate entry-point Layer provisioning as well as non-entry-point use, and its own diagnostic instructs real entry points to suppress it. It cannot establish the architectural distinction it demands. The strict preset retains narrower lifecycle and Layer-composition checks.[4]

Add these default-off rules as errors. All names have the `effecttsgo/` prefix and were checked against the published presets:

| Rules | Policy goal |
| --- | --- |
| `global-date-in-effect`, `global-random-in-effect`, `global-timers-in-effect`, `crypto-random-uuid-in-effect` | Use Effect's clock, randomness, scheduling and crypto APIs inside Effect code. |
| `global-fetch-in-effect`, `global-console-in-effect`, `process-env-in-effect` | Keep networking, logging and configuration within Effect's APIs inside Effect code. |
| `prefer-schema-over-json` | Use Schema codecs at JSON boundaries. This also applies outside generators. |
| `prefer-schema-tagged-error` | Give domain errors explicit Schema contracts. |
| `instance-of-schema` | Prefer Schema validation to constructor-identity checks. |
| `nested-effect-gen-yield` | Remove redundant generator nesting. |

Do not enable Effect's boolean-expression rule: the base already owns that policy. Do not import the whole `effect-native` or `style` preset: these add whole-project native-API bans, opposing import preferences, and replacements that may change semantics. Contextual restrictions permit ordinary async framework callbacks and external adapters outside Effect code. Do not add the maintainers preset's public-library release policy.[3][4]

## Verification performed

Temporary fixtures installed Effect `4.1.1`, Oxlint `1.90.0`, `oxlint-tsgolint` `7.0.2005`, and `@effect/tsgo` `0.63.0` with dependency lifecycle scripts disabled. Later probes also installed the policy's pinned Tailwind/Convex plugins and test-owned Convex runtime `1.48.0`. No dependencies, binaries, user editor configuration, or implementation files in this repository were changed.

- **Passed:** one combined config emitted both `eslint(no-debugger)` and `effecttsgo(floating-effect)` as errors in one invocation. A clean Effect program and an ordinary external async adapter exited 0.
- **Passed:** a dropped Effect in a generator with a real yielded result passed the base policy alone and failed the Effect-enabled policy.
- **Passed:** raw console, clock and randomness inside a generator produced the contextual opt-in diagnostics. The corrected Clock/Random/Effect logging program exited 0.
- **Passed:** unknown error channels were diagnosed without an explicit rule entry, confirming ordinary category selection applies to Effect rules. Error/context-erasing assertions also triggered the base's existing unsafe-assertion rule.
- **Passed:** an entry-point Layer provision triggered `strict-effect-provide`, confirming the defended-exception case.
- **Passed:** the existing config composer combined base, Effect, Tailwind and Convex fragments. The Effect runner reported the expected Tailwind and Convex violations; valid mixed-integration fixtures passed.
- **Passed:** the native Oxlint LSP completed initialization and published ordinary plus Effect diagnostics at LSP error severity. Unsaved current-file corrections cleared them, and unsaved regressions restored them.
- **Passed:** a headless Neovim session (`-u NONE -i NONE -n`) using its native LSP client received both rule families, cleared them after an unsaved correction, and restored them after an unsaved regression. This used the combined config including Tailwind and Convex. The test did not modify the user's Neovim configuration.
- **Passed:** a full-project invocation with base and Convex exclusions combined checked 15 source files and reported 18 source violations, with no dependency diagnostics.
- **Passed:** stock Oxlint still rejected the Effect config afterward; the wrapper had not patched installed tools.

These are feasibility probes, not maintained regression coverage. The proposed script-replacement syntax has not been implemented or tested.

## Acceptance work still needed

Add maintained tests for script replacement, conflict reporting, deselection, original-command preservation, each opt-in, lint/fix exit behavior, and mixed integrations. Confirm package-manager executable discovery and supported platform behavior. Current-file unsaved diagnostics were demonstrated; unsaved cross-file dependency overlays, monorepo roots and every code action were not.

Make top-level `ignorePatterns` compose by ordered union/deduplication, like plugin lists, so integrations add exclusions without dropping the base exclusions. `composeConfigurations` currently treats this field atomically: the Convex fragment replaces the base patterns. An earlier Effect probe without explicit dependency exclusions traversed dependency sources; the combined-exclusions full-project probe passed that check. This is a proposed generic composition correction, not implemented behavior. Update the existing tests that intentionally specify atomic ignore-array replacement; do not silently change the contract.

## Sources

[1]: https://unpkg.com/@effect/tsgo@0.63.0/README.md "Published wrapper contract, supported versions and platform limits"
[2]: https://github.com/Effect-TS/eslint-plugin/tree/44bba8afb40ad3f36be7acc35d70afe067e424f9/src "Official ESLint plugin exports and formatter conflict configuration"
[3]: https://unpkg.com/@effect/tsgo@0.63.0/oxlint-presets/ "Published version-pinned presets"
[4]: https://github.com/Effect-TS/tsgo/tree/f8c0a17bc26b195e1ee463dce9ae5b0770d852eb/docs/rules "Official rule descriptions, cross-checked against the published package"
[5]: https://github.com/Effect-TS/tsgo/blob/f8c0a17bc26b195e1ee463dce9ae5b0770d852eb/docs/README.md "Effect's official Oxlint integration and diagnostic ownership"
[6]: https://raw.githubusercontent.com/neovim/nvim-lspconfig/master/lsp/oxlint.lua "Current Neovim Oxlint LSP configuration"
[7]: https://oxc.rs/docs/guide/usage/linter/lsp-config-reference.html "Oxlint LSP type-aware configuration and config discovery"
[8]: https://raw.githubusercontent.com/mfussenegger/nvim-lint/master/lua/lint/linters/oxlint.lua "Disk-based Oxlint adapter and its GitHub-annotation parser"
