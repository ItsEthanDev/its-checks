import { Data } from "effect";

/** All expected policy, decoding, and filesystem failures use this channel. */
export class BundleError extends Data.TaggedError("BundleError")<{
  readonly bundle: string;
  readonly source: string;
  readonly field: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `${this.bundle}: ${this.source} [${this.field}]: ${this.detail}`;
  }
}
