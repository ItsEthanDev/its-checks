import * as clack from "@clack/prompts";
import { Effect, Schema } from "effect";

import { ApplicationError, OperationError } from "../../application/index.ts";
import { safePath } from "../../policy/documents.ts";
import type { DeclaredInput, Answer } from "../../policy/index.ts";
import { Cancelled, type Question, type SetupPresentation } from "../../setup/index.ts";

const ask = <A>(prompt: () => Promise<A | typeof clack.CANCEL_SYMBOL>): Question<A> =>
  Effect.gen(function* () {
    const answer = yield* Effect.tryPromise({
      try: prompt,
      catch: (cause) => new OperationError({ detail: String(cause) }),
    });
    if (clack.isCancel(answer)) {
      return yield* new Cancelled();
    }
    return answer;
  });
function parseInput(declaration: DeclaredInput, value: string): Answer {
  return declaration.input.type === "number" ? Number(value) : value;
}
function validate(declaration: DeclaredInput, value: string | undefined) {
  const text = value ?? "";
  if (
    declaration.input.type === "number" &&
    (text.trim().length === 0 || !Number.isFinite(Number(text)))
  ) {
    return "Enter a finite number.";
  }
  if (declaration.input.type === "path" && !safePath(text)) {
    return "Enter a safe path relative to the target package (for example src/app.css).";
  }
  return undefined;
}
const choices: SetupPresentation["choices"] = (source, options, previous) => {
  // Clack needs a focusable option. Empty catalogs still have an explicit checkbox dialogue.
  const empty = "";
  return ask(() =>
    clack.multiselect({
      message: `Choose ${source} (Space toggles, Enter confirms)`,
      required: false,
      options:
        options.length > 0
          ? options.map((bundle) => ({
              value: bundle.id,
              label: bundle.declaration.name,
              hint: bundle.declaration.description,
            }))
          : [{ value: empty, label: "None available" }],
      initialValues: [...previous],
    }),
  ).pipe(Effect.map((ids) => ids.filter((id) => id !== empty)));
};
const input: SetupPresentation["input"] = (declaration) => {
  const message = `${declaration.input.prompt} (${declaration.bundle}/${declaration.input.id})`;
  if (declaration.input.type === "boolean") {
    return ask(() =>
      clack.confirm({
        message,
        ...(typeof declaration.initialValue !== "boolean"
          ? {}
          : { initialValue: declaration.initialValue }),
      }),
    );
  }
  return ask(() =>
    clack.text({
      message,
      ...(declaration.initialValue === undefined
        ? {}
        : { initialValue: String(declaration.initialValue) }),
      validate: (value) => validate(declaration, value),
    }),
  ).pipe(Effect.map((value) => parseInput(declaration, value)));
};
export function createClackPresentation(): {
  readonly presentation: SetupPresentation;
  readonly failure: (error: unknown) => void;
} {
  const spinner = clack.spinner();
  let spinning = false;
  const stop = (message: string, failed = false) => {
    if (spinning) {
      if (failed) {
        spinner.error(message);
      } else {
        spinner.stop(message);
      }
      spinning = false;
    }
  };
  const presentation: SetupPresentation = {
    choices,
    input,
    manager: (question) => {
      clack.note([question.reason, ...question.evidence].join("\n"), "Target package manager");
      return ask(() =>
        clack.select({
          message: "Which package manager should modify this package?",
          options: question.choices.map((value) => ({ value, label: value })),
        }),
      );
    },
    confirm: (message) =>
      ask(() =>
        clack.confirm({
          message,
          initialValue: false,
        }),
      ),
    note: (message) => clack.log.warn(message),
    plan: showPlan,
    progress: (message) => {
      spinner.start(message);
      spinning = true;
    },
    complete: (report) => {
      stop("Configuration and dependency installation finished.");
      const files = report.completed.filter(
        (operation) => operation.kind === "write-file" || operation.kind === "remove-file",
      );
      clack.outro(
        `Completed: ${files.length} file changes; dependencies ${report.dependencyWork}.`,
      );
    },
  };
  return {
    presentation,
    failure: (error: unknown): void => {
      stop("Setup did not complete.", true);
      showFailure(error);
    },
  };
}

const showPlan: SetupPresentation["plan"] = (plan) => {
  const files = plan.files.filter((file) => file.kind !== "noop");
  const entries = plan.packageEntries.filter((entry) => entry.kind !== "noop");
  clack.note(
    [
      ...(plan.sources ?? []).map((source) => `Policy: ${source.repository}@${source.commit}`),
      ...(plan.bundles ?? []).map(
        (bundle) =>
          `${bundle.explicit ? "Selected" : "Dependency"}: ${bundle.key}${bundle.requiredBy.length === 0 ? "" : `; required by ${bundle.requiredBy.join(", ")}`}`,
      ),
      ...files.map(
        (file) =>
          `${file.kind}: ${file.path}${file.conflict ? " [conflict]" : ""}\n  ${file.reasons.join("; ")}`,
      ),
      ...entries.map(
        (entry) =>
          `${entry.kind}: ${entry.section}.${entry.name}: ${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}`,
      ),
      files.length > 0 ? "" : "Configuration already matches; no file writes.",
      "Dependencies: run the selected package manager's install after configuration.",
      "Normal installation uses project settings and may run lifecycle scripts; setup does not audit the installed tree.",
    ]
      .filter(Boolean)
      .join("\n"),
    "Read-only change plan",
  );
};

function showFailure(error: unknown): void {
  if (Schema.is(Cancelled)(error)) {
    clack.cancel("Cancelled before application. No project writes or installation.");
    return;
  }
  clack.log.error(error instanceof Error ? error.message : String(error));
  if (Schema.is(ApplicationError)(error)) {
    clack.note(
      [
        `Completed: ${error.report.completed.length === 0 ? "none" : error.report.completed.map((op) => `${op.kind} ${op.path}`).join(", ")}`,
        `Incomplete: ${error.report.incomplete.length === 0 ? "none" : error.report.incomplete.map((op) => `${op.kind} ${op.path}`).join(", ")}`,
        `Dependencies: ${error.report.dependencyWork}.`,
        error.report.retry ?? "Inspect the project before retrying.",
        "Already applied changes remain; no rollback was performed.",
      ].join("\n"),
      "Partial completion / failure",
    );
  } else {
    clack.log.info("Stopped before application. No project writes or installation.");
  }
  clack.outro("Setup failed.");
}
