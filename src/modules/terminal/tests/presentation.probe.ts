import { ApplicationError } from "../../application/index.ts";
import { Cancelled } from "../../setup/index.ts";
import { createClackPresentation } from "../index.ts";

const ui = createClackPresentation();
switch (process.argv[2]) {
  case "preview":
    ui.presentation.plan({
      snapshot: { root: "/fixture", files: {} },
      files: [
        {
          path: "config.json",
          before: { kind: "absent" },
          after: { kind: "absent" },
          kind: "replacement",
          conflict: true,
          reasons: ["selected configuration"],
        },
      ],
      packageEntries: [
        {
          section: "scripts",
          name: "check",
          before: "old",
          after: "new",
          kind: "replacement",
          conflict: true,
        },
      ],
      requiresConfirmation: true,
      complete: true,
      deferred: [],
    });
    ui.presentation.complete({
      status: "completed",
      completed: [{ kind: "write-file", path: "config.json" }],
      incomplete: [],
      dependencyWork: "completed",
    });
    break;
  case "failure":
    ui.failure(
      new ApplicationError({
        phase: "dependencies",
        detail: "Install failed",
        report: {
          status: "failed",
          completed: [{ kind: "write-file", path: "config.json" }],
          incomplete: [{ kind: "install-dependencies", path: "package.json" }],
          dependencyWork: "started",
          retry: "Fix installation and retry.",
        },
      }),
    );
    break;
  case "cancel":
    ui.failure(new Cancelled());
    break;
  case undefined:
  default:
    throw new Error("Unknown presentation scenario");
}
