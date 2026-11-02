# Effect

Select the Effect integration to run the base, Effect, and other selected lint rules together through `effect-tsgo oxlint`. It replaces the managed base `lint` and `lint:fix` commands; `check` already invokes lint. Deselecting Effect restores stock Oxlint.

The integration pins `@effect/tsgo` to `0.63.0`, compatible with the policy's Oxlint `1.90.0` and `oxlint-tsgolint` `7.0.2005`. It does not install or change your application's Effect version, replace your TypeScript configuration, or patch installed binaries. The packaged Effect-enabled Oxlint components do not support Linux musl.

If an existing user-authored script invokes stock Oxlint directly, update that command explicitly. The CLI preserves user scripts; it does not rewrite their shell text. Stock Oxlint cannot read a config containing the `effecttsgo` plugin.

## Policy

The combined `.oxlintrc.json` inherits Effect's strict preset and retains the base `correctness` and `suspicious` categories. Opt-ins prefer Effect APIs for clock, randomness, crypto, timers, networking, logging and configuration inside Effect code; Schema codecs and tagged errors; Schema-aware checks; and flatter generators. Ordinary async framework callbacks remain allowed outside Effect code.

The pinned `prefer-schema-over-json` rule checks JSON operations inside Effect code, not every JSON operation in the project. A clean lint run does not establish that all external data is validated.

Three rules are disabled when Effect is selected:

- `effecttsgo/strict-effect-provide` also rejects legitimate entry-point Layer provisioning. The rule cannot distinguish the architecture it demands; narrower Layer checks remain enabled.
- `effecttsgo/unstable-api-usage` rejects the official `HttpClient` and `SecureRandom` services recommended by the contextual rules. Those APIs are marked unstable in Effect 4.1.1. Accept their versioning risk rather than require contradictory rules or pervasive suppressions. Experimental-API and deprecated-API checks remain enabled.
- `unicorn/throw-new-error` mistakes `Schema.TaggedError`'s class factory for an error constructor missing `new`. It has no configurable exclusion. Disable that syntactic check rather than distort valid class definitions; typed-error and unsafe-value checks remain enabled.

## Neovim

Use the Oxlint language server through the same Effect-enabled runner. Keep your existing TypeScript language server for typechecking, completion, navigation and hovers.

With Neovim 0.11+ and current nvim-lspconfig, configure the `oxlint` server for your Effect projects:

```lua
vim.lsp.config('oxlint', {
  cmd = function(dispatchers, config)
    local root = assert(config.root_dir, 'Oxlint needs a project root')
    return vim.lsp.rpc.start(
      { root .. '/node_modules/.bin/effect-tsgo', 'oxlint', '--lsp' },
      dispatchers,
      { cwd = root }
    )
  end,
  settings = {
    typeAware = true,
    configPath = '.oxlintrc.json',
  },
})
vim.lsp.enable('oxlint')
```

This assumes a project-local `node_modules/.bin` installation. For other package-manager layouts, use the equivalent local executable and project working directory. In a monorepo, the selected root must own the config and tools. `configPath` selects that root config and disables nested config discovery.

The server reports ordinary and Effect lint diagnostics, including unsaved current-file edits. Do not also run stock Oxlint or an on-save lint adapter over the same buffers. If using Effect's separate TypeScript language service for its additional editor features, disable its duplicate Effect diagnostics rather than maintaining two diagnostic policies.

Sources: [Effect's version-pinned wrapper documentation](https://unpkg.com/@effect/tsgo@0.63.0/README.md), [Oxlint LSP configuration](https://oxc.rs/docs/guide/usage/linter/lsp-config-reference.html), [nvim-lspconfig's Oxlint server](https://github.com/neovim/nvim-lspconfig/blob/master/lsp/oxlint.lua).
