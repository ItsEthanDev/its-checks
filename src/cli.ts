import { fileURLToPath } from "node:url";

import * as clack from "@clack/prompts";
import { Effect, Schema } from "effect";

import { headless } from "./modules/headless/index.ts";
import { Cancelled, setup } from "./modules/setup/index.ts";
import { createClackPresentation, showBundleNotes } from "./modules/terminal/index.ts";

const args = process.argv.slice(2);
const command = args[0];
const interactive = process.stdin.isTTY && process.stdout.isTTY;
if (command === undefined || command === "add" || command === "update" || command === "remove") {
  const valid =
    command === undefined || command === "update" ? args.length <= 2 : args.length === 2;
  if (!valid || args.some((arg) => arg.startsWith("-"))) {
    console.error(
      "Usage: its-checks [add <owner/repo> | update [owner/repo] | remove <owner/repo>]",
    );
    process.exitCode = 1;
  } else if (!interactive) {
    console.error(
      "Interactive commands require a terminal. For headless usage, use options, plan, or apply.",
    );
    process.exitCode = 1;
  } else {
    clack.intro("its-checks");
    const ui = createClackPresentation();
    await Effect.runPromise(
      setup({
        interactive,
        projectRoot: process.cwd(),
        presentation: ui.presentation,
        ...(command === undefined ? {} : { command }),
        ...(args[1] === undefined ? {} : { repository: args[1] }),
      }).pipe(
        Effect.match({
          onFailure: (error) => {
            ui.failure(error);
            process.exitCode = Schema.is(Cancelled)(error) ? 130 : 1;
          },
          onSuccess: (report) => {
            if (report.status === "declined") {
              clack.cancel("Plan declined. No project writes or installation.");
            } else if (report.status === "no-sources") {
              clack.outro("Add a policy source to begin.");
            }
          },
        }),
      ),
    );
  }
} else {
  await Effect.runPromise(
    headless(args, process.cwd(), fileURLToPath(new URL("../", import.meta.url))).pipe(
      Effect.match({
        onFailure: (error) => {
          const { _tag: code } = error;
          console.error(
            args.includes("--json")
              ? JSON.stringify({
                  error: { code, message: error.message, details: error },
                })
              : error.message,
          );
          process.exitCode = 1;
        },
        onSuccess: (output) => {
          console.log(
            output.json
              ? JSON.stringify(output.result)
              : (output.text ?? JSON.stringify(output.result, null, 2)),
          );
          if (!output.json) {
            showBundleNotes(output.notes ?? []);
          }
        },
      }),
    ),
  );
}
