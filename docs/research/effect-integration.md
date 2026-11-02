# Effect integration recommendation

Status: researched proposal; no policy integration implemented.

## Use the official native integration

Pin `@effect/tsgo` to `0.63.0`. Its published support matrix includes the base policy's Oxlint `1.90.0` and `oxlint-tsgolint` `7.0.2005`. It supports Effect v3 and v4, with individual rules limited to the versions they understand. The repository currently uses Effect `4.1.1`.[1]

Use `effect-tsgo oxlint`, which launches the installed Oxlint CLI with packaged Effect-enabled native components. This avoids patching `node_modules`, install lifecycle hooks, or changing the consumer's TypeScript installation. The Oxlint runner does not require installing TypeScript 7. Packaged Oxlint components do not support Linux musl.[1]

Do not use `@effect/eslint-plugin` for semantic checks. It exports only `dprint` and `no-import-from-barrel-package`; its formatter preset disables rules including `curly`, conflicting with this policy.[2]

## Fit the existing CLI without changing it

Add `policy/typescript/integrations/effect/` with a bundle declaration and a separate native `.oxlintrc.effect.json` file. Install only the development tool; preserve the application's Effect runtime version.

The integration contributes these commands to the existing scripts:

```json
{
  "lint": "effect-tsgo oxlint --deny-warnings --config .oxlintrc.effect.json .",
  "lint:fix": "effect-tsgo oxlint --fix --deny-warnings --config .oxlintrc.effect.json ."
}
```

The CLI composes these after the base commands. Keep Effect rules out of the main `.oxlintrc.json`: stock Oxlint rejects the `effecttsgo` plugin. No additional `check` command is needed because the base check invokes the composed lint script.

The Effect config should extend the published strict preset, disable the ordinary correctness category for this separate pass, and explicitly ignore dependencies and build output. The strict preset supplies the `effecttsgo` plugin and type-aware mode; do not restate them.[3]

```json
{
  "$schema": "./node_modules/@effect/tsgo/oxlint-schema.json",
  "extends": ["./node_modules/@effect/tsgo/oxlint-presets/strict.json"],
  "categories": { "correctness": "off" },
  "ignorePatterns": ["**/node_modules/**", "dist/**", "coverage/**"]
}
```

This adds a second type-aware lint pass. It keeps the base and other integrations on their existing runner and needs neither compiler/editor configuration changes nor binary patching.

## Rule selection

### Start with strict

The **published 0.63.0** strict preset enables 91 rules as errors. It contains the default-enabled Effect diagnostics, not every available rule. Its coverage includes floating Effects, missing error/service requirements, incorrect generator yielding, nested Effects and Promises, service/Layer composition mistakes, broad untyped errors, Schema mistakes, and idiomatic simplifications.[3]

Inherit this preset instead of copying its rules into the policy. In particular, `floating-effect` is not redundant with the base's `no-floating-promises`: an Effect is lazy and is not a Promise.

Use the installed package's presets and schema as the versioned authority. The inspected repository snapshot already had additions absent from the published package.[3][4]

### Add these default-off rules as errors

All names have the `effecttsgo/` prefix. The published presets establish that these rules exist but are not enabled by strict.[3]

| Rules | Policy goal |
| --- | --- |
| `any-unknown-in-error-context` | Preserve concrete typed failures and service requirements; keep `unknown` legal at untrusted input boundaries. |
| `global-date-in-effect`, `global-random-in-effect`, `global-timers-in-effect`, `crypto-random-uuid-in-effect` | Use Effect's clock, randomness, scheduling, and crypto APIs inside Effect code rather than ambient globals. |
| `global-fetch-in-effect`, `global-console-in-effect`, `process-env-in-effect` | Keep networking, logging, and configuration in Effect's typed, substitutable APIs inside Effect code. |
| `prefer-schema-over-json` | Use Schema codecs at JSON boundaries rather than unchecked parsing or serialization. This rule also applies outside generators. |
| `prefer-schema-tagged-error` | Give domain errors explicit Schema contracts. |
| `instance-of-schema` | Use Schema validation rather than only constructor identity for Schema values. |
| `nested-effect-gen-yield` | Remove redundant generator nesting. |

The contextual global rules deliberately do not ban async functions or native APIs across an entire mixed React/Convex/Effect project. External adapters and framework callbacks remain possible. Do not also enable the corresponding whole-project global rules without a separate architectural decision.[4]

### Omit duplicates and unsupported assumptions

- Do not enable Effect's `strict-boolean-expressions`; the base already owns that policy.
- Do not enable `unsafe-effect-type-assertion` initially. The base's category-enabled `typescript/no-unsafe-type-assertion` already rejected the tested assertions erasing error and requirements channels. Add the Effect-specific rule only if a distinct uncovered case is demonstrated.
- Do not import the entire `effect-native` or `style` preset. These add blanket native-API bans, opposing import preferences, and choices not inherently better for every use. Native Array/String/Record replacements can change semantics.[4]
- Do not enable `strict-effect-provide` by default: it also reports legitimate entry-point provisioning and instructs those callers to suppress it. Existing strict checks catch narrower lifecycle mistakes.[4]
- Do not enable the maintainers preset: `api-stability-leak` is a public-library release policy.[3]
- No Effect-specific formatter or formatting options are needed. Keep Oxfmt as the single formatter.
- Adding `compilerOptions.plugins` alone does not make ordinary TypeScript or stock Oxlint enforce Effect diagnostics. Editor integration is separate from the proposed CI path.[1][5]

## Verification performed

Temporary fixtures installed Effect `4.1.1`, Oxlint `1.90.0`, `oxlint-tsgolint` `7.0.2005`, and `@effect/tsgo` `0.63.0` using `npm install --ignore-scripts --no-audit --no-fund`. No dependencies or binaries in this repository were changed.

- **Passed:** a generator yielding a result but dropping `Effect.logInfo(...)` passed the base policy and failed the Effect pass with `effecttsgo(floating-effect)` at error severity, exit 1.
- **Passed:** a clean `Effect.succeed` program exited 0 under the Effect pass.
- **Passed:** raw console, clock, and randomness inside a generator produced the three corresponding contextual diagnostics. The corrected Clock/Random/Effect logging program exited 0.
- **Passed:** error-channel and Scope-requirement assertions produced the existing base `typescript(no-unsafe-type-assertion)` errors as well as the optional Effect-specific diagnostic when temporarily enabled, establishing overlap for those cases.
- **Passed:** a temporary Effect bundle was loaded, planned, and applied through the existing CLI modules. The generated `npm run lint` ran base Oxlint followed by the separate Effect runner and exited 0 on valid fixtures.
- **Passed:** stock Oxlint still rejected the Effect-only config afterward, confirming that the wrapper had not patched the installed stock tools.
- **Found and addressed in the probe:** the separate Effect pass needs explicit dependency exclusions. Without them, the patched runner traversed dependency sources and their nested TypeScript configurations when invoked on `.`. Adding the ignore patterns above made the composed command pass.

Before shipping, add maintained integration tests for all selected opt-ins, error exits and fixes, base-rule preservation, real Effect.fn/service/Schema/Layer code, mixed integrations, and generated-file exclusions. These probes are feasibility evidence, not complete regression coverage.

## Sources

[1]: https://unpkg.com/@effect/tsgo@0.63.0/README.md "Published @effect/tsgo 0.63.0 README: supported versions, wrapper commands and platform limits"
[2]: https://github.com/Effect-TS/eslint-plugin/tree/44bba8afb40ad3f36be7acc35d70afe067e424f9/src "Official ESLint plugin exports and formatting-conflict config"
[3]: https://unpkg.com/@effect/tsgo@0.63.0/oxlint-presets/ "Published, version-pinned Effect Oxlint presets"
[4]: https://github.com/Effect-TS/tsgo/tree/f8c0a17bc26b195e1ee463dce9ae5b0770d852eb/docs/rules "Official diagnostic descriptions; availability cross-checked against the published presets"
[5]: https://github.com/Effect-TS/tsgo/blob/f8c0a17bc26b195e1ee463dce9ae5b0770d852eb/docs/README.md "Official Oxlint integration and editor diagnostic ownership"
