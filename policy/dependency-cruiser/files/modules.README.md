# Modules

## TODO: Migrate to deep modules

Give the following prompt to your coding agent to plan and carry out the migration. This section is temporary; remove it only after the completion criteria in the prompt are met.

```text
Refactor this codebase into cohesive deep modules: small public interfaces that hide substantial implementation complexity, improving code quality, testing, and maintenance while preserving behavior.

Read `src/modules/README.md` and follow its module conventions, especially its testing guidance. The dependency-cruiser bundle is already installed.

## 1. Explore and propose

Explore the codebase, its callers, and its tests. Capture existing behavior and baseline check failures. Design module boundaries around responsibilities rather than the current file layout.

Keep code that is already cohesive in place. Prefer fewer, deeper modules over wrappers that merely forward calls.

Present a lightweight module breakdown: each module's responsibility and intended public interface, plus only the boundary tradeoffs needed to judge the design. Use your judgment for implementation details. Stop for user approval before editing.

## 2. Implement after approval

Refactor to the approved design. Internal interfaces and their callers may change; preserve externally consumed APIs, user-visible behavior, data formats, and side effects. Ask about ambiguous behavior or necessary breaking changes.

Redesign the tests around the modules' observable behavior rather than carrying the existing test structure forward. Rewrite, merge, delete, prune, or move tests as needed, preserving meaningful behavioral coverage at the appropriate boundaries. Before replacing or deleting tests, identify the behavior they protect and account for it in the resulting suite. Follow the README's testing guidance: tests describe what a module does through its public interface, not how it works. Do not expose internals solely for testing.

Update the module catalog and run the project's relevant checks, including dependency-cruiser. Verify preserved behavior against the baseline and report remaining failures or verification gaps. Passing dependency rules alone is not the goal; assess whether the resulting modules hide complexity behind cohesive interfaces.

## 3. Remove this TODO after verification

Once the approved migration is complete, the module catalog is current, and verification demonstrates preserved behavior with no new check failures, remove this migration TODO section, including its embedded prompt. Preserve the rest of the README. If verification gaps or migration work remain, leave the TODO in place and report them. Existing, unrelated baseline failures do not block removal.
```

## Required structure

Each module exposes public entry points at its root. All subdirectories are private to that module.

```text
src/modules/
  <name>/
    index.ts        # Public entry point.
    client.ts       # Optional additional public entry point.
    lib/            # Private implementation.
    tests/          # Tests, helpers, and fixtures.
```

- **Public entry points:** Import modules through their root files. A module may expose several entry points; `index.ts` is not the only allowed name. Keep root files focused on the public interface.
- **Private implementation:** Put implementation in `lib/` or other subdirectories. Code within a module may import its own implementation directly. Application code and other modules must use its public entry points.
- **Tests:** Keep tests, helpers, and fixtures in `tests/`. Tests must exercise public entry points, not import private implementation. Tests may import helpers and fixtures from their own module's `tests/` directory. Production code must not import test code.

## Test observable behavior

Test what a module does, not how it is implemented. Exercise behavior through the module's public entry points and assert observable results and effects, not private helpers or internal call sequences.

Do not expose implementation details through the public interface solely to test them. If a private function contains behavior worth testing, cover that behavior through the public operation that depends on it. Move the coverage to a better test boundary; do not drop it.

Write module tests as executable requirements. Test names, scenarios, and assertions should explain the module's responsibilities and expected behavior, including failure cases. Reading `tests/` should teach a reader what the module promises, not how its implementation works. Refactoring internals without changing observable behavior should not require rewriting tests.

## Module catalog

List each module below with a link to its directory and a brief description of its responsibility. Update this catalog when adding, renaming, or removing a module.

| Module | Responsibility |
| ------ | -------------- |
