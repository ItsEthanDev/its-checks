import type { QueryCtx } from "./_generated/server.js";

export async function requireAccess(ctx: QueryCtx): Promise<void> {
  if ((await ctx.auth.getUserIdentity()) === null) {
    throw new Error("Authentication required");
  }
}
