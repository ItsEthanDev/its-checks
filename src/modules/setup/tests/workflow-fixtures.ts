import { Effect } from "effect";

import type { ApplicationDependencies } from "../../application/index.ts";
import type { Answer } from "../../policy/index.ts";
import type { SetupPresentation } from "../index.ts";
export const ready: ApplicationDependencies = {
  assess: () => Effect.succeed("not-required"),
  install: () => Effect.die("Unexpected install"),
};
export function dialogue(
  options: {
    readonly selections?: Readonly<Record<string, readonly string[]>>;
    readonly approve?: boolean;
    readonly answers?: Readonly<Record<string, Answer>>;
  } = {},
): {
  readonly ui: SetupPresentation;
  readonly notes: string[];
  readonly shown: { source: string; ids: readonly string[]; previous: readonly string[] }[];
  readonly questions: string[];
} {
  const notes: string[] = [];
  const shown: {
    source: string;
    ids: readonly string[];
    previous: readonly string[];
  }[] = [];
  const questions: string[] = [];
  const ui: SetupPresentation = {
    choices: (source, bundles, previous) => {
      shown.push({ source, ids: bundles.map((bundle) => bundle.id), previous });
      return Effect.succeed(options.selections?.[source] ?? previous);
    },
    input: (declaration) => {
      questions.push(`${declaration.bundle}/${declaration.input.id}`);
      return Effect.succeed(
        options.answers?.[`${declaration.bundle}/${declaration.input.id}`] ??
          declaration.initialValue ??
          "",
      );
    },
    manager: () => Effect.succeed("npm"),
    confirm: () => Effect.succeed(options.approve ?? true),
    note: (message) => {
      notes.push(message);
    },
    plan: () => {
      /* Recorded by module-level planning tests. */
    },
    progress: () => {
      /* Presentation only. */
    },
    complete: () => {
      /* Report returned by setup. */
    },
  };
  return { ui, notes, shown, questions };
}
