import * as Effect from "effect/Effect";

export const ambient = Effect.gen(function* () {
  const random = Math.random();
  const time = Date.now();
  const id = crypto.randomUUID();
  const timer = setTimeout(() => 1, 10);
  const url = process.env.API_URL;
  const response = fetch("https://example.invalid");
  console.log(random);
  return yield* Effect.succeed({ random, time, id, timer, url, response });
});
