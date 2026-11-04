import { Effect } from "effect";

import type { fixture } from "../../../../test/shared/fixtures.ts";
import type { ApplicationDependencies, ApplicationReport } from "../../application/index.ts";
import type { ChangePlan } from "../../planning/index.ts";
import type { Answer } from "../../policy/index.ts";
import type { SetupPresentation } from "../index.ts";

interface Dialogue {
  ui: SetupPresentation;
  shown: { category: string; previous: readonly string[]; options: string[] }[];
  questions: { key: string; initial: Answer | undefined }[];
  notes: string[];
  readonly plan: ChangePlan | undefined;
  readonly confirmations: number;
  readonly managerQuestions: number;
  readonly completion: ApplicationReport | undefined;
}

export function dialogue(
  choices: {
    integrations?: readonly string[];
    automation?: readonly string[];
    approve?: boolean;
    answers?: Record<string, Answer>;
  } = {},
): Dialogue {
  const shown: { category: string; previous: readonly string[]; options: string[] }[] = [];
  const questions: { key: string; initial: Answer | undefined }[] = [];
  const notes: string[] = [];
  let plan: ChangePlan | undefined;
  let confirmations = 0;
  let managerQuestions = 0;
  let completion: ApplicationReport | undefined;
  const ui: SetupPresentation = {
    choices: (category, options, previous) => {
      shown.push({ category, previous, options: options.map((x) => x.id) });
      return Effect.succeed(choices[category] ?? previous);
    },
    input: (declaration) => {
      const key = `${declaration.bundle}/${declaration.input.id}`;
      questions.push({ key, initial: declaration.initialValue });
      return Effect.succeed(choices.answers?.[key] ?? declaration.initialValue ?? "");
    },
    manager: () => {
      managerQuestions++;
      return Effect.succeed("npm");
    },
    confirm: () => {
      confirmations++;
      return Effect.succeed(choices.approve ?? true);
    },
    note: (message) => {
      notes.push(message);
    },
    plan: (value) => {
      plan = value;
    },
    progress: () => {
      /* empty */
    },
    complete: (value) => {
      completion = value;
    },
  };
  return {
    ui,
    shown,
    questions,
    notes,
    get plan() {
      return plan;
    },
    get confirmations() {
      return confirmations;
    },
    get managerQuestions() {
      return managerQuestions;
    },
    get completion() {
      return completion;
    },
  };
}
export const ready: ApplicationDependencies = {
  assess: () => Effect.succeed("not-required"),
  install: () => Effect.die("Unexpected installation"),
};
export async function inputPolicy(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await f.add("integrations/example", {
    name: "Example",
    inputs: [
      {
        id: "stylesheet",
        prompt: "Stylesheet path?",
        type: "path",
        default: "src/app.css",
        destination: { file: ".oxfmtrc.json", field: ["sortTailwindcss", "stylesheet"] },
      },
    ],
    devDependencies: { example: "1.0.0" },
  });
  await f.write("typescript/integrations/example/files/.oxfmtrc.json", {
    sortTailwindcss: { stylesheet: "placeholder" },
  });
  await f.add("automation/ci", { name: "CI" });
  await f.write(
    "typescript/automation/ci/files/.github/workflows/check.yml",
    "# its-checks: managed\nname: Checks\non: push\n",
  );
}
