# Modules

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

| Module                      | Responsibility                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [application](application/) | Apply approved change plans, install dependencies with the target package manager, and report completed and incomplete work. |
| [headless](headless/)       | Handle noninteractive commands for inspecting policy options, saving change plans, and applying saved plans.                 |
| [planning](planning/)       | Compose policy contributions into project change plans, identify conflicts, and detect target changes.                       |
| [policy](policy/)           | Resolve policy sources, discover and load bundles, validate selections and inputs, and read saved intent.                    |
| [setup](setup/)             | Coordinate source selection, input collection, plan preparation, approval, and application through a presentation interface. |
| [terminal](terminal/)       | Provide terminal prompts and display change plans, progress, results, and bundle notes.                                      |
