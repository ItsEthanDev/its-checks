import * as clack from "@clack/prompts";
import { Effect } from "effect";
import { ApplicationError, OperationError } from "./application.ts";
import { safePath } from "./bundle-loading.ts";
import type { DeclaredInput } from "./inputs.ts";
import type { Answer } from "./selections.ts";
import { Cancelled, type Question, type SetupPresentation } from "./workflow.ts";

const ask = <A>(prompt: () => Promise<A | typeof clack.CANCEL_SYMBOL>): Question<A> => Effect.gen(function*() {
  const answer = yield* Effect.tryPromise({ try: prompt, catch: (cause) => new OperationError({ detail: String(cause) }) });
  if (clack.isCancel(answer)) return yield* Effect.fail(new Cancelled());
  return answer as A;
});
function parseInput(declaration: DeclaredInput, value: string): Answer {
  return declaration.input.type === "number" ? Number(value) : value;
}
function validate(declaration: DeclaredInput, value: string | undefined) {
  const text = value ?? "";
  if (declaration.input.type === "number" && (!text.trim() || !Number.isFinite(Number(text)))) return "Enter a finite number.";
  if (declaration.input.type === "path" && !safePath(text)) return "Enter a safe path relative to the target package (for example src/app.css).";
}
export function createClackPresentation() {
  const spinner = clack.spinner();
  let spinning = false;
  const stop = (message: string, failed = false) => {
    if (spinning) { if (failed) spinner.error(message); else spinner.stop(message); spinning = false; }
  };
  const presentation: SetupPresentation = {
    choices: (category, options, previous) => {
      // Clack needs a focusable option. Empty catalogs still have an explicit checkbox dialogue.
      const empty = "";
      return ask(() => clack.multiselect({
        message: `Choose ${category} (Space toggles, Enter confirms)`, required: false,
        options: options.length ? options.map((bundle) => ({ value: bundle.id, label: bundle.declaration.name,
          ...(bundle.declaration.description === undefined ? {} : { hint: bundle.declaration.description }) })) : [{ value: empty, label: "None available" }],
        initialValues: [...previous],
      })).pipe(Effect.map((ids) => ids.filter((id) => id !== empty)));
    },
    input: (declaration) => {
      const message = `${declaration.input.prompt} (${declaration.bundle}/${declaration.input.id})`;
      if (declaration.input.type === "boolean") return ask(() => clack.confirm({ message,
        ...(declaration.initialValue === undefined ? {} : { initialValue: declaration.initialValue as boolean }) }));
      return ask(() => clack.text({ message,
        ...(declaration.initialValue === undefined ? {} : { initialValue: String(declaration.initialValue) }),
        validate: (value) => validate(declaration, value),
      })).pipe(Effect.map((value) => parseInput(declaration, value)));
    },
    manager: (question) => {
      clack.note([question.reason, ...question.evidence].join("\n"), "Target package manager");
      return ask(() => clack.select({ message: "Which package manager should modify this package?",
        options: question.choices.map((value) => ({ value, label: value })) }));
    },
    confirm: () => ask(() => clack.confirm({ message: "Apply this plan, including replacements and removals?", initialValue: false })),
    note: (message) => clack.log.warn(message),
    plan: (plan, dependencies) => {
      const files = plan.files.filter((file) => file.kind !== "noop");
      const entries = plan.packageEntries.filter((entry) => entry.kind !== "noop");
      clack.note([
        ...files.map((file) => `${file.kind}: ${file.path}${file.conflict ? " [conflict]" : ""}\n  ${file.reasons.join("; ")}`),
        ...entries.map((entry) => `${entry.kind}: ${entry.section}.${entry.name}: ${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}`),
        files.length ? "" : "Configuration already matches; no file writes.",
        `Dependencies: ${dependencies === "required" ? "run the selected package manager's install after configuration" : "installation skipped"}.`,
        "Normal installation uses project settings and may run lifecycle scripts; setup does not audit the installed tree.",
      ].filter(Boolean).join("\n"), "Read-only change plan");
    },
    progress: (message) => { spinner.start(message); spinning = true; },
    complete: (report) => {
      stop("Configuration and dependency installation finished.");
      const files = report.completed.filter((operation) => operation.kind === "write-file" || operation.kind === "remove-file");
      clack.outro(files.length === 0 && report.dependencyWork === "not-required" ? "Already up to date. No writes or installation."
        : `Completed: ${files.length} file changes; dependencies ${report.dependencyWork}.`);
    },
  };
  return { presentation, failure: (error: unknown) => {
    stop("Setup did not complete.", true);
    if (error instanceof Cancelled) { clack.cancel("Cancelled before application. No project writes or installation."); return; }
    clack.log.error(error instanceof Error ? error.message : String(error));
    if (error instanceof ApplicationError) {
      clack.note([
        `Completed: ${error.report.completed.map((op) => `${op.kind} ${op.path}`).join(", ") || "none"}`,
        `Incomplete: ${error.report.incomplete.map((op) => `${op.kind} ${op.path}`).join(", ") || "none"}`,
        `Dependencies: ${error.report.dependencyWork}.`, error.report.retry ?? "Inspect the project before retrying.",
        "Already applied changes remain; no rollback was performed.",
      ].join("\n"), "Partial completion / failure");
    } else clack.log.info("Stopped before application. No project writes or installation.");
    clack.outro("Setup failed.");
  } };
}
