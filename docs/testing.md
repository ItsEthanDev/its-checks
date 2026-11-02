# Testing

Test the CLI, not the shipped policy's opinions. A compatible change to `policy/` must not require test changes.

Use fixed, test-owned example policies and isolated target projects for behavioral tests. Do not refresh reference fixtures from the shipped policy to follow its changes. Assert discovery, validation, composition, application, scripts, conflicts, reruns, deselection, and dependency handling—not the shipped policy's chosen rules, diagnostics, formatting, or tool versions.

Tool compatibility tests may execute fixed reference configurations. Packaging tests may check that policy files ship unchanged without prescribing their contents. Temporary verification of a policy edit must not become a permanent policy assertion.

Run the relevant checks with Bun:

| Command | Coverage |
| --- | --- |
| `bun run test` | CLI contracts using test-owned fixtures |
| `bun run typecheck` | Source and test types |
| `bun run test:managers` | Real package-manager behavior |
| `bun run test:policy` | CLI/tool compatibility using the fixed reference policy |
| `bun run test:cli` | Interactive terminal behavior |
| `bun run test:package` | Packaged CLI and runtime assets |

Integration checks use temporary projects; some install dependencies. Keep effects isolated and inspect dependency lifecycle hooks before allowing them to execute.
