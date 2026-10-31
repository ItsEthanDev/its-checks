import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { Effect } from "effect";
import { createClackPresentation } from "./presentation.ts";
import { Cancelled, setup } from "./workflow.ts";

// Development source entrypoint only. Policy belongs to the executed checkout, never the target cwd.
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
if (!interactive || process.argv.length > 2) {
  console.error(!interactive
    ? "its-checks requires an interactive terminal (stdin and stdout). Run it directly from the target package in a terminal; unattended flags are not supported."
    : "its-checks accepts no arguments or unattended flags. Run it from the target package directory.");
  process.exitCode = 1;
} else {
  clack.intro("its-checks");
  const ui = createClackPresentation();
  await Effect.runPromise(setup({ interactive, projectRoot: process.cwd(),
    policyRoot: fileURLToPath(new URL("../policy/", import.meta.url)), presentation: ui.presentation,
  }).pipe(Effect.match({
    onFailure: (error) => { ui.failure(error); process.exitCode = error instanceof Cancelled ? 130 : 1; },
    onSuccess: (report) => { if (report.status === "declined") clack.cancel("Plan declined. No project writes or installation."); },
  })));
}
