import { z } from "npm:zod";

export const QueryPlanSchema = z.object({
  sql: z.string().trim().min(1).max(12000),
});

export const PlannerSchema = z.object({
  mode: z.enum(["chat", "financial_query"]),
  query: QueryPlanSchema.optional(),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export type ModeHint = "chat" | "financial";
