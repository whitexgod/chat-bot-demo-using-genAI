import { getGeminiClient } from "./clients.ts";
import { PlannerSchema, type ModeHint } from "./schemas.ts";

export async function planRequest(message: string, modeHint?: ModeHint, isAdmin = false) {
  const client = getGeminiClient();

  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
Classify the user request and return only valid JSON.
No markdown.
No explanation.

Allowed modes:
- chat: normal conversation or advice that does not require DB querying.
- financial_query: read-only analytics/query over available public tables.

Database schema available for financial_query:
Tables:
- public.transactions
Columns:
- id (uuid)
- user_id (uuid)
- amount (numeric)
- debit (numeric)
- credit (numeric)
- category (text)
- merchant (text)
- date (date)
- created_at (timestamptz)

- public.profiles
Columns:
- id (uuid)
- role (app_role)
- created_at (timestamptz)

- public.chats
Columns:
- id (uuid)
- user_id (uuid)
- created_at (timestamptz)

- public.messages
Columns:
- id (uuid)
- chat_id (uuid)
- role (text)
- content (text)
- created_at (timestamptz)

- public.ai_query_logs
Columns:
- id (uuid)
- user_id (uuid)
- role (app_role)
- chat_id (uuid)
- status (text)
- row_count (integer)
- duration_ms (integer)
- started_at (timestamptz)
- finished_at (timestamptz)
- created_at (timestamptz)

Security rules:
- Only read (SELECT) operations are allowed.
- Admin users can query data for all users or a specific user.
- Non-admin users can query only from public.transactions.
- Non-admin users can only query their own transaction data.
- For non-admin users, always set from_table = "public.transactions".

If mode is financial_query, include query object:
{
  "operation": "select",
  "from_table": "public.transactions" | "public.profiles" | "public.chats" | "public.messages" | "public.ai_query_logs",
  "metric": "sum" | "avg" | "count" | "min" | "max",
  "value_field"?: "amount" | "debit" | "credit" | "duration_ms" | "row_count",
  "group_by"?: "id" | "user_id" | "chat_id" | "role" | "status" | "category" | "merchant" | "date" | "created_at" | "finished_at" | null,
  "sort_by"?: "value" | "id" | "user_id" | "chat_id" | "role" | "status" | "category" | "merchant" | "date" | "created_at" | "finished_at",
  "sort_dir": "asc" | "desc",
  "limit": 1..500,
  "filters": {
    "id"?: "uuid",
    "user_id"?: "uuid",
    "chat_id"?: "uuid",
    "role"?: "user" | "assistant" | "admin",
    "status"?: "generated" | "success" | "error",
    "category"?: string,
    "merchant"?: string,
    "min_amount"?: number,
    "max_amount"?: number,
    "min_debit"?: number,
    "max_debit"?: number,
    "min_credit"?: number,
    "max_credit"?: number,
    "min_duration_ms"?: number,
    "max_duration_ms"?: number,
    "min_row_count"?: number,
    "max_row_count"?: number,
    "date_from"?: "YYYY-MM-DD",
    "date_to"?: "YYYY-MM-DD"
  }
}

Mode hint from UI: ${modeHint ?? "none"}
Requester role: ${isAdmin ? "admin" : "user"}
User message: ${message}
`,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  const parsed = JSON.parse(response.text ?? "{}");
  return PlannerSchema.parse(parsed);
}

export async function generateChatReply(message: string) {
  const client = getGeminiClient();

  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
You are a helpful financial assistant.
Respond in clear markdown.
Keep it concise and practical.
Use Indian Rupees (INR) for all monetary values.
Always format money with the ₹ symbol.

User message:
${message}
`,
    config: { temperature: 0.3 },
  });

  return response.text?.trim() || "I could not generate a response.";
}

export async function summarizeFinancialResult(message: string, sqlData: unknown) {
  const client = getGeminiClient();

  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
You are a financial assistant.
Given DB results, answer the user in human-readable markdown.
If no rows, clearly say no matching records were found.
Use Indian Rupees (INR) for all monetary values.
Always format money with the ₹ symbol.

User message:
${message}

DB result JSON:
${JSON.stringify(sqlData)}
`,
    config: { temperature: 0.2 },
  });

  return response.text?.trim() || "I could not summarize the result.";
}
