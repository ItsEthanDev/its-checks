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
      notes: [
        {
          bundle: "example/fork:base",
          name: "Fixture tools",
          message: "**MIGRATION NOTE**\n\nRead docs/guide.md.\nKeep this second line.",
        },
        {
          bundle: "other/policy:extra",
          name: "Other tools",
          message: "Review the generated files.",
        },
      ],
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
          notes: [],
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
