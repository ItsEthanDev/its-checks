import { stripVTControlCharacters, styleText } from "node:util";

import * as clack from "@clack/prompts";

import type { BundleNote } from "../../planning/index.ts";

/** Render bundle-authored follow-up text without interpreting arbitrary terminal escapes. */
export function showBundleNotes(notes: readonly BundleNote[]): void {
  for (const note of notes) {
    const message = stripVTControlCharacters(note.message).replace(
      /\*\*([^*]+)\*\*/g,
      (_, text: string) => styleText("bold", text),
    );
    clack.note(message, styleText(["cyan", "bold"], stripVTControlCharacters(note.name)), {
      withGuide: false,
    });
  }
}
