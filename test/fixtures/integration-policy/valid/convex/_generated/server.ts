// Test-owned equivalent of generated server types; no Convex CLI or deployment.
import { queryGeneric, internalQueryGeneric } from "convex/server";
import type { DataModelFromSchemaDefinition, QueryBuilder, GenericQueryCtx } from "convex/server";
import type schema from "../schema.js";

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type QueryCtx = GenericQueryCtx<DataModel>;
export const query: QueryBuilder<DataModel, "public"> = queryGeneric;
export const internalQuery: QueryBuilder<DataModel, "internal"> = internalQueryGeneric;
