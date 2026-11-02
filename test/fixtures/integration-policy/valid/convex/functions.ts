import { v } from "convex/values";
import { query, internalQuery } from "./_generated/server.js";
import { requireAccess } from "./auth.js";

export const countOwned = query({
  args: { owner: v.string() },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    await requireAccess(ctx);
    const messages = await ctx.db.query("messages").withIndex("by_owner", (q) => q.eq("owner", args.owner)).take(10);
    return messages.length;
  },
});

export const internalCount = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const messages = await ctx.db.query("messages").take(10);
    return messages.length;
  },
});
