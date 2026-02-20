import { z } from "npm:zod";

export const QueryPlanSchema = z.object({
  metric: z.enum(["sum", "avg", "count"]),
  group_by: z.enum(["category", "merchant"]).nullable(),
  filters: z
    .object({
      category: z.string().trim().min(1).max(80).optional(),
      merchant: z.string().trim().min(1).max(120).optional(),
      date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .partial()
    .optional(),
});

export const PlannerSchema = z.object({
  mode: z.enum(["chat", "financial_query"]),
  query: QueryPlanSchema.optional(),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export type ModeHint = "chat" | "financial";
