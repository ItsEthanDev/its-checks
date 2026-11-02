import { Schema } from "effect";

/** Read-only planning failures; no external operations have been performed. */
export class PlanError extends Schema.TaggedError<PlanError, { readonly brand: unique symbol }>()(
  "PlanError",
  {
    source: Schema.String,
    field: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `${this.source}: ${this.field}: ${this.detail}`;
  }
}
