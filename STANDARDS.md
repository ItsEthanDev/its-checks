# Project standards

- Treat the reusable CLI and the opinionated bundled policy as separate products. Keep policy-specific logic out of the CLI.
- Keep policy decisions in configuration. Compatible changes to rules, options, severities, integrations, or tool versions must not require documentation or test updates.
- Bundles install policy tooling, not project prerequisites. Leave application libraries, frameworks, and the TypeScript compiler under the consuming project's ownership. Assume projects selecting an integration supply its prerequisites; do not add prerequisite validation just to support unprepared projects.
- Document CLI mechanisms and contracts, not the shipped policy's current choices.
- Keep `policy/README.md` brief and focused on motivation, not rule catalogs or integration details.
- Test CLI contracts, not policy opinions. Follow [testing guidance](docs/testing.md).
- Keep research and policy rationale in conversation unless a repository artifact is explicitly requested.
