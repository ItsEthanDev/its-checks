import { Data } from "effect";

/** Read-only planning failures; no external operations have been performed. */
export class PlanError extends Data.TaggedError("PlanError")<{
  readonly source: string;
  readonly field: string;
  readonly detail: string;
}> {
  override get message() { return `${this.source}: ${this.field}: ${this.detail}`; }
}
