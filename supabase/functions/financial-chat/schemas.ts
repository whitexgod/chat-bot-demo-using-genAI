import { z } from "npm:zod";

const TableNameSchema = z.enum([
  "public.transactions",
  "public.profiles",
  "public.chats",
  "public.messages",
  "public.ai_query_logs",
]);

const FieldSchema = z.enum([
  "id",
  "user_id",
  "chat_id",
  "role",
  "status",
  "category",
  "merchant",
  "date",
  "created_at",
  "finished_at",
  "amount",
  "debit",
  "credit",
  "duration_ms",
  "row_count",
]);

export const QueryPlanSchema = z.object({
  operation: z.literal("select").default("select"),
  from_table: TableNameSchema.default("public.transactions"),
  metric: z.enum(["sum", "avg", "count", "min", "max"]),
  value_field: FieldSchema.optional(),
  group_by: z
    .preprocess((value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized || normalized === "none" || normalized === "null") return null;
      }
      return value;
    }, FieldSchema.nullable())
    .default(null),
  sort_by: z.union([z.literal("value"), FieldSchema]).default("value"),
  sort_dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().min(1).max(500).default(100),
  filters: z
    .object({
      id: z.string().uuid().optional(),
      category: z.string().trim().min(1).max(80).optional(),
      merchant: z.string().trim().min(1).max(120).optional(),
      user_id: z.string().uuid().optional(),
      chat_id: z.string().uuid().optional(),
      role: z.enum(["user", "assistant", "admin"]).optional(),
      status: z.enum(["generated", "success", "error"]).optional(),
      min_amount: z.number().finite().optional(),
      max_amount: z.number().finite().optional(),
      min_debit: z.number().finite().optional(),
      max_debit: z.number().finite().optional(),
      min_credit: z.number().finite().optional(),
      max_credit: z.number().finite().optional(),
      min_duration_ms: z.number().finite().optional(),
      max_duration_ms: z.number().finite().optional(),
      min_row_count: z.number().finite().optional(),
      max_row_count: z.number().finite().optional(),
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
