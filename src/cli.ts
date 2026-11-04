import { fileURLToPath } from "node:url";

import * as clack from "@clack/prompts";
import { Effect, Schema } from "effect";

import { headless } from "./modules/headless/index.ts";
import { Cancelled, executingCommit, setup } from "./modules/setup/index.ts";
import { createClackPresentation } from "./modules/terminal/index.ts";

// Policy belongs to the executed package/checkout, never the target cwd.
const interactive = process.stdin.isTTY && process.stdout.isTTY;
if (process.argv.length > 2) {
  await Effect.runPromise(
    headless(
      process.argv.slice(2),
      process.cwd(),
      fileURLToPath(new URL("../", import.meta.url)),
    ).pipe(
      Effect.match({
        onFailure: (error) => {
          const { _tag: code } = error;
          if (process.argv.includes("--json")) {
            console.error(
              Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({
                error: { code, message: error.message, details: error },
              }),
            );
          } else {
            console.error(error.message);
          }
          process.exitCode = 1;
        },
        onSuccess: (output) =>
          console.log(
            output.json
              ? JSON.stringify(output.result)
              : (output.text ?? JSON.stringify(output.result, null, 2)),
          ),
      }),
    ),
  );
} else if (!interactive) {
  console.error(
    "its-checks requires an interactive terminal (stdin and stdout). For headless usage, use options, plan, or apply.",
  );
  process.exitCode = 1;
} else {
  clack.intro("its-checks");
  const ui = createClackPresentation();
  await Effect.runPromise(
    Effect.gen(function* () {
      const commit = yield* executingCommit(fileURLToPath(new URL("../", import.meta.url)));
      return yield* setup({
        interactive,
        projectRoot: process.cwd(),
        policyRoot: fileURLToPath(new URL("../policy/", import.meta.url)),
        presentation: ui.presentation,
        ...(commit === undefined ? {} : { commit }),
      });
    }).pipe(
      Effect.match({
        onFailure: (error) => {
          ui.failure(error);
          process.exitCode = Schema.is(Cancelled)(error) ? 130 : 1;
        },
        onSuccess: (report) => {
          if (report.status === "declined") {
            clack.cancel("Plan declined. No project writes or installation.");
          }
        },
      }),
    ),
  );
}
