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

## Module catalog

List each module below with a link to its directory and a brief description of its responsibility. Update this catalog when adding, renaming, or removing a module.

| Module | Responsibility |
| ------ | -------------- |
