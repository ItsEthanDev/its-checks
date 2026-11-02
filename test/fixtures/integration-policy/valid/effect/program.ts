import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import { SecureRandom } from "effect/crypto";
import { HttpClient } from "effect/http";

export const program = Effect.gen(function* () {
  const random = yield* Random.next;
  const time = yield* Clock.currentTimeMillis;
  yield* Effect.sleep("10 millis");
  const url = yield* Config.String("API_URL");
  const secure = yield* SecureRandom.SecureRandom;
  const id = yield* secure.uuidV4();
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get(url);
  yield* Effect.logInfo(id);
  return { random, time, id, status: response.status };
});

export class Settings extends Context.Service<Settings, { readonly enabled: boolean }>()("Settings") {}
export const SettingsLive = Layer.succeed(Settings, { enabled: true });
export const supplied: Effect.Effect<boolean> = Effect.gen(function* () {
  const settings = yield* Settings;
  return settings.enabled;
}).pipe(Effect.provide(SettingsLive));

export class User extends Schema.Class<User, { readonly brand: unique symbol }>("User")({ name: Schema.String }) {}
export class InvalidUser extends Schema.TaggedError<InvalidUser, { readonly brand: unique symbol }>()("InvalidUser", { reason: Schema.String }) {}
export const decodeUser = Schema.decodeUnknownEffect(Schema.fromJsonString(User));
export const encodeUser = Schema.encodeEffect(Schema.fromJsonString(User));

export function isUser(value: unknown): value is User {
  return Schema.is(User)(value);
}

export const checked = Effect.fn("checked")(function* (value: unknown) {
  const user = yield* Schema.decodeUnknownEffect(User)(value);
  return user.name;
});

// Framework callbacks outside Effect remain ordinary async functions.
export async function external(value: Promise<number>): Promise<number> {
  return await value;
}
