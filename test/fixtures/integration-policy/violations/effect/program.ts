import * as Effect from "effect/Effect";

export const floating = Effect.gen(function* () {
  Effect.logInfo("Never executed");
  return yield* Effect.succeed(1);
});

declare const input: unknown;
export const unknownFailure = Effect.fail(input);

export const nested = Effect.gen(function* () {
  return yield* Effect.gen(function* () {
    const value = yield* Effect.succeed(1);
    return value;
  });
});

debugger;
