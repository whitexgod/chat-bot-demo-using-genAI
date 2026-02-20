import { getGeminiClient } from "./clients.ts";
import { PlannerSchema, type ModeHint } from "./schemas.ts";

export async function planRequest(message: string, modeHint?: ModeHint) {
  const client = getGeminiClient();

  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
Classify the user request and return only valid JSON.
No markdown.
No explanation.

Allowed modes:
- chat: normal conversation or advice that does not require DB querying.
- financial_query: spending/transaction analytics that should query transactions table.

If mode is financial_query, include query object:
{
  "metric": "sum" | "avg" | "count",
  "group_by": "category" | "merchant" | null,
  "filters": {
    "category"?: string,
    "merchant"?: string,
    "date_from"?: "YYYY-MM-DD",
    "date_to"?: "YYYY-MM-DD"
  }
}

Mode hint from UI: ${modeHint ?? "none"}
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
