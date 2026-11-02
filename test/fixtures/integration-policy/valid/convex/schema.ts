import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({ owner: v.string(), body: v.string() }).index("by_owner", ["owner"]),
});
