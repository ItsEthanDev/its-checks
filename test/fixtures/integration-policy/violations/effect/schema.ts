import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const json = Effect.gen(function* () {
  const parsed: unknown = JSON.parse('{}');
  const encoded = JSON.stringify({ active: true });
  return yield* Effect.succeed({ parsed, encoded });
});

export class Failed extends Data.TaggedError("Failed")<{ readonly reason: string }> {}
export class User extends Schema.Class<User, { readonly brand: unique symbol }>("User")({ name: Schema.String }) {}

export function isUser(value: unknown): value is User {
  return value instanceof User;
}
