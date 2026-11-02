import { v } from "convex/values";
import { query } from "../../valid/convex/_generated/server.js";
import { requireAccess } from "../../valid/convex/auth.js";

export const missingAccess = query({
  args: {},
  returns: v.number(),
  handler: (): number => 1,
});

function checkInput(): boolean {
  return true;
}

export const misleadingCheck = query({
  args: {},
  returns: v.number(),
  handler: (): number => {
    checkInput();
    return 1;
  },
});

export const unbounded = query({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    await requireAccess(ctx);
    const messages = await ctx.db.query("messages").collect();
    return messages.length;
  },
});

export const filtered = query({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    await requireAccess(ctx);
    const messages = await ctx.db.query("messages").filter((q) => q.eq(q.field("owner"), "owner")).take(10);
    return messages.length;
  },
});
