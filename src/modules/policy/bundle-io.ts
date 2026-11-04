import assert from "node:assert/strict";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { TextDecoder } from "node:util";

import { Effect, Schema } from "effect";
import { parse, printParseErrorCode, visit, type ParseError } from "jsonc-parser";

import { BundleError } from "./bundle-errors.ts";
import type { JsonValue } from "./bundle-types.ts";

export type Context = { readonly bundle: string; readonly source: string };
export const compare = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};
export const fail = (ctx: Context, field: string, detail: string): BundleError =>
  new BundleError({ ...ctx, field, detail });
export const io = <A>(ctx: Context, operation: () => Promise<A>): Effect.Effect<A, BundleError> =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => fail(ctx, "$", cause instanceof Error ? cause.message : String(cause)),
  });
export const validate = (
  ctx: Context,
  field: string,
  valid: boolean,
  detail: string,
): Effect.Effect<void, BundleError> =>
  valid ? Effect.void : Effect.fail(fail(ctx, field, detail));

/** Portable target-relative names; never interpret Windows paths on POSIX. */
export function safePath(value: string): boolean {
  return (
    value.length > 0 &&
    // oxlint-disable-next-line no-control-regex -- Portable paths must reject control characters.
    !/[\\:<>"|?*\x00-\x1f\x7f]/.test(value) &&
    value
      .split("/")
      .every(
        (part) =>
          part.length > 0 &&
          part !== "." &&
          part !== ".." &&
          !/[. ]$/.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
          ![".git", "node_modules"].includes(part.toLowerCase()),
      )
  );
}
export const checkPath = (
  ctx: Context,
  field: string,
  value: string,
): Effect.Effect<void, BundleError> =>
  validate(
    ctx,
    field,
    safePath(value),
    `Expected a safe target-relative POSIX path, got ${JSON.stringify(value)}`,
  );

/** Strict local UTF-8 read; never follows the final symbolic link. */
export function readText(ctx: Context): Effect.Effect<string, BundleError> {
  return Effect.gen(function* () {
    const stat = yield* io(ctx, () => fs.lstat(ctx.source));
    yield* validate(
      ctx,
      "$",
      stat.isFile(),
      "Expected a regular file; symbolic links are not supported",
    );
    return yield* Effect.acquireUseRelease(
      io(ctx, () => fs.open(ctx.source, constants.O_RDONLY | constants.O_NOFOLLOW)),
      (handle) =>
        io(ctx, async () =>
          new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile()),
        ),
      (handle) => io(ctx, () => handle.close()),
    );
  });
}

/** Strict JSON/JSONC parsing shared with saved intent. */
export function json(
  ctx: Context,
  content: string,
  comments: boolean,
): Effect.Effect<JsonValue, BundleError> {
  return Effect.try({
    try: () => {
      const errors: ParseError[] = [];
      const options = {
        disallowComments: !comments,
        allowTrailingComma: comments,
        allowEmptyContent: false,
      };
      // Both JSON and JSONC normally accept duplicate keys. Policy cannot silently lose declarations.
      const objects: Set<string>[] = [];
      let invalid: string | undefined;
      visit(
        content,
        {
          onObjectBegin: () => {
            objects.push(new Set());
          },
          onObjectProperty: (name, offset) => {
            const keys = objects.at(-1);
            assert(keys !== undefined);
            if (keys.has(name)) {
              invalid = `Duplicate object key ${JSON.stringify(name)} at offset ${offset}`;
            }
            // jsonc-parser assigns to ordinary objects; this key would alter their prototypes.
            if (name === "__proto__") {
              invalid = `Unsupported prototype key at offset ${offset}`;
            }
            keys.add(name);
          },
          onLiteralValue: (value, offset) => {
            if (typeof value === "number" && !Number.isFinite(value)) {
              invalid = `Nonfinite JSON number at offset ${offset}`;
            }
          },
          onObjectEnd: () => {
            objects.pop();
          },
        },
        options,
      );
      if (invalid !== undefined) {
        throw new Error(invalid);
      }
      const value: unknown = parse(content, errors, options);
      if (errors.length > 0) {
        throw new Error(
          errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join("; "),
        );
      }
      return value;
    },
    catch: (cause) => fail(ctx, "$", cause instanceof Error ? cause.message : String(cause)),
  }).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(Schema.Json)(value).pipe(
        Effect.mapError((cause) => fail(ctx, "$", cause.message)),
      ),
    ),
  );
}
export function decode<S extends Schema.Constraint & { readonly DecodingServices: never }>(
  ctx: Context,
  schema: S,
  value: unknown,
): Effect.Effect<S["Type"], BundleError> {
  return Schema.decodeUnknownEffect(schema, { onExcessProperty: "error", errors: "all" })(
    value,
  ).pipe(Effect.mapError((cause) => fail(ctx, "$", cause.message)));
}
export function directory(ctx: Context, optional = false): Effect.Effect<string[], BundleError> {
  return Effect.gen(function* () {
    const stat = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await fs.lstat(ctx.source);
        } catch (cause) {
          if (optional && cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
            return undefined;
          }
          throw cause;
        }
      },
      catch: (cause) => fail(ctx, "$", cause instanceof Error ? cause.message : String(cause)),
    });
    if (stat === undefined) {
      return [];
    }
    yield* validate(
      ctx,
      "$",
      stat.isDirectory(),
      "Expected a directory; symbolic links are not supported",
    );
    return (yield* io(ctx, () => fs.readdir(ctx.source))).toSorted(compare);
  });
}
export function unique(
  ctx: Context,
  field: string,
  values: readonly string[],
): Effect.Effect<void, BundleError> {
  return validate(
    ctx,
    field,
    new Set(values.map((s) => s.toLowerCase())).size === values.length,
    "Duplicate identity or path (including case-insensitive aliases)",
  );
}
