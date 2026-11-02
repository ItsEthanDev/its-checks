import { Schema } from "effect";

/** All expected policy, decoding, and filesystem failures use this channel. */
export class BundleError extends Schema.TaggedError<
  BundleError,
  { readonly brand: unique symbol }
>()("BundleError", {
  bundle: Schema.String,
  source: Schema.String,
  field: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `${this.bundle}: ${this.source} [${this.field}]: ${this.detail}`;
  }
}
