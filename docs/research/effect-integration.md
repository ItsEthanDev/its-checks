# Effect integration research

The integration is implemented. See [Effect setup and policy exceptions](../effect.md), [script contribution semantics](../customize-policy.md#script-contributions), and the [native policy fragment](../../policy/typescript/integrations/effect/files/.oxlintrc.json) for maintained configuration. This note records the investigation and evidence behind those choices.

## Runner selection

The official `@effect/tsgo@0.63.0` package explicitly supports Oxlint `1.90.0` and `oxlint-tsgolint` `7.0.2005`. Its wrapper runs the installed Oxlint CLI with packaged Effect-enabled native components, without patching installed binaries or requiring a TypeScript 7 installation for the Oxlint path. Packaged Oxlint components do not support Linux musl.[1]

Stock Oxlint cannot load the `effecttsgo` plugin. A separate Effect pass was feasible, but unnecessarily duplicated linting and required separate editor wiring. The combined runner accepts ordinary native rules, Effect rules, and the existing Tailwind/Convex JavaScript plugins together.

The CLI originally concatenated every selected bundle's script contributions. Targeted replacement of one named bundle's ordinary command provides runner selection without an Effect-specific branch, shell parsing, or a tool registry. It preserves the target's position, other contributions, and user-authored commands; deselection recomputes the base command. Existing user commands invoking stock Oxlint still require explicit migration rather than automatic shell rewriting.

Top-level ignore arrays now compose additively. Previously, the Convex fragment replaced the base exclusions. A probe without dependency exclusions traversed dependency sources; preserving the union prevents that failure in full-project checks.

## Native rule selection

The **published 0.63.0** strict preset has 91 rules, not every available diagnostic. It promotes the upstream default-enabled set to errors. Use the installed package's presets and schema as the versioned authority: the inspected source snapshot already had additions absent from the published package.[2][3]

The native plugin maps its rules to ordinary Oxlint categories. With the base policy's wholesale `correctness` and `suspicious`, three additional rules are enabled beyond strict:

- `effecttsgo/any-unknown-in-error-context`
- `effecttsgo/unsafe-effect-type-assertion`
- `effecttsgo/strict-effect-provide`

No explicit enablement is needed for these category members. The generic base unsafe-assertion rule also rejected the tested error/context-erasing casts. `strict-effect-provide` needs a defended exception because it reports legitimate entry-point Layer provisioning.

Real valid-alternative fixtures exposed two further conflicts. Strict's `unstable-api-usage` rejected the official HttpClient and SecureRandom services recommended by the contextual rules. The base `unicorn/throw-new-error` rule misidentified `Schema.TaggedError`'s class factory as a constructor missing `new`, with no configurable exclusion. The integration disables those rules rather than requiring distorted code or suppressions on every correct use. Their rationale and retained checks are documented in the operational guide.

The pinned `prefer-schema-over-json` rule is contextual: JSON operations outside Effect code did not produce diagnostics, while both parsing and serialization inside a generator did. It must not be advertised as project-wide JSON-boundary enforcement. Newer source contains replacement diagnostics that are absent from the published native package.[3]

The small `@effect/eslint-plugin` package is not a semantic-rule alternative: its exported rules are `dprint` and `no-import-from-barrel-package`; its formatter conflict preset disables `curly`.[4] Oxfmt remains the single formatter.

## Editor path

Use `effect-tsgo oxlint --lsp` alongside the existing TypeScript language server. Current nvim-lspconfig names the server `oxlint`; configure its command to use the project-local wrapper, with project-root working directory and type-aware linting. This produces editor and CI diagnostics from the same `.oxlintrc.json`.[1][5][6]

The existing nvim-lint adapter is a disk-backed fallback, not an unsaved-buffer interface. It parses GitHub annotations rather than JSON. Pinned Oxlint has no source-stdin CLI option. Its native LSP, however, synchronizes document contents and supports unsaved current-file diagnostics.[7]

Effect's separate TypeScript language service is optional for additional editor features. Its diagnostic settings are distinct from Oxlint's; Effect recommends disabling duplicate Effect language-service diagnostics when Oxlint owns linting.[8]

## Verification

The temporary probes and maintained integration test use Effect `4.1.1`, Oxlint `1.90.0`, `oxlint-tsgolint` `7.0.2005`, and `@effect/tsgo` `0.63.0`. Dependencies are installed in isolated targets with lifecycle scripts disabled; no remote Convex deployment or code generation is involved.

- One combined invocation reports both ordinary and Effect errors; the same config also reports Tailwind and Convex violations.
- A dropped Effect inside a generator with a real yielded result passes the base policy alone and fails the Effect-enabled policy.
- Each contextual opt-in is exercised by a violating fixture and valid Effect-native alternatives. Valid Effect.fn, Schema classes/tagged errors, shared Layers, and external async callbacks pass.
- Full-project public `lint` and `lint:fix` scripts pass on corrected fixtures and ignore deliberately invalid dependency/build files. There is only one managed lint runner.
- Deselection restores stock Oxlint and removes the managed tool dependency without changing the application's Effect version.
- The maintained native-LSP test verifies both diagnostic families, clearing after an unsaved correction, and restoring after an unsaved regression, followed by clean shutdown.
- An isolated headless Neovim session (`-u NONE -i NONE -n`) also received and updated both diagnostic families without modifying personal editor configuration.
- Planning tests cover replacement position, original-command preservation, deduplication after replacement, missing/conflicting targets, identical replacements, deselection, and all four target-manager wrappers.

Maintained checks live in `test/scripts.test.ts`, `test/planning.test.ts`, and `test/integration-policy.integration.ts` with `test/oxlint-lsp.ts`. Unsaved cross-file dependency overlays, every code action, all monorepo layouts, and non-Linux platforms were not established by these probes.

## Sources

[1]: https://unpkg.com/@effect/tsgo@0.63.0/README.md "Published wrapper contract, supported versions and platform limits"
[2]: https://unpkg.com/@effect/tsgo@0.63.0/oxlint-presets/ "Published version-pinned presets"
[3]: https://github.com/Effect-TS/tsgo/tree/f8c0a17bc26b195e1ee463dce9ae5b0770d852eb/docs/rules "Official rule descriptions, cross-checked against the published native rule catalog"
[4]: https://github.com/Effect-TS/eslint-plugin/tree/44bba8afb40ad3f36be7acc35d70afe067e424f9/src "Official ESLint plugin exports and formatter conflict configuration"
[5]: https://raw.githubusercontent.com/neovim/nvim-lspconfig/master/lsp/oxlint.lua "Current Neovim Oxlint LSP configuration"
[6]: https://oxc.rs/docs/guide/usage/linter/lsp-config-reference.html "Oxlint LSP type-aware configuration and config discovery"
[7]: https://raw.githubusercontent.com/mfussenegger/nvim-lint/master/lua/lint/linters/oxlint.lua "Disk-based Oxlint adapter and GitHub-annotation parser"
[8]: https://github.com/Effect-TS/tsgo/blob/f8c0a17bc26b195e1ee463dce9ae5b0770d852eb/docs/README.md "Effect's official Oxlint integration and diagnostic ownership"
