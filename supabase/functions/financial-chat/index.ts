import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { GoogleGenAI } from "npm:@google/genai";
import { z } from "npm:zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const QueryPlanSchema = z.object({
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

const PlannerSchema = z.object({
  mode: z.enum(["chat", "financial_query"]),
  query: QueryPlanSchema.optional(),
});

type QueryPlan = z.infer<typeof QueryPlanSchema>;
type ModeHint = "chat" | "financial";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildQuery(plan: QueryPlan) {
  const metricExpr =
    plan.metric === "count" ? "COUNT(*)" : `${plan.metric.toUpperCase()}(amount)`;

  const selectClause = plan.group_by
    ? `${plan.group_by}, ${metricExpr} AS value`
    : `${metricExpr} AS value`;

  const conditions: string[] = ["true"];
  const filters = plan.filters;

  if (filters?.category) conditions.push(`category = ${sqlLiteral(filters.category)}`);
  if (filters?.merchant) conditions.push(`merchant = ${sqlLiteral(filters.merchant)}`);
  if (filters?.date_from) conditions.push(`date >= ${sqlLiteral(filters.date_from)}`);
  if (filters?.date_to) conditions.push(`date <= ${sqlLiteral(filters.date_to)}`);

  const groupClause = plan.group_by ? `GROUP BY ${plan.group_by}` : "";

  return `
    SELECT ${selectClause}
    FROM public.transactions
    WHERE ${conditions.join(" AND ")}
    ${groupClause}
    LIMIT 500
  `;
}

function getGeminiClient() {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  return new GoogleGenAI({ apiKey });
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

function getAccessToken(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim();
}

async function getCurrentUserId(supabase: ReturnType<typeof createClient>, req: Request) {
  const token = getAccessToken(req);
  if (!token) throw new Error("Missing bearer token");

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid JWT");
  return data.user.id;
}

async function validateChatOwnership(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  chatId: string,
) {
  const { data, error } = await supabase
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

async function getOrCreateChatId(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  chatId?: string,
) {
  if (chatId) {
    const isOwner = await validateChatOwnership(supabase, userId, chatId);
    if (isOwner) return chatId;
  }

  const { data, error } = await supabase
    .from("chats")
    .insert({ user_id: userId })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

async function saveMessage(
  supabase: ReturnType<typeof createClient>,
  chatId: string,
  role: "user" | "assistant",
  content: string,
) {
  const { error } = await supabase.from("messages").insert({
    chat_id: chatId,
    role,
    content,
  });

  if (error) throw error;
}

async function loadHistory(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  chatId?: string,
) {
  if (!chatId) return { chatId: null, messages: [] as Array<{ role: string; content: string }> };

  const isOwner = await validateChatOwnership(supabase, userId, chatId);
  if (!isOwner) return { chatId: null, messages: [] as Array<{ role: string; content: string }> };

  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return {
    chatId,
    messages: (data ?? []).map((m) => ({ role: m.role, content: m.content })),
  };
}

async function planRequest(message: string, modeHint?: ModeHint) {
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

async function generateChatReply(message: string) {
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

async function summarizeFinancialResult(message: string, sqlData: unknown) {
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { message, modeHint, action, chatId } = body;

    const supabase = getAdminClient();
    const userId = await getCurrentUserId(supabase, req);

    if (action === "history") {
      const history = await loadHistory(
        supabase,
        userId,
        typeof chatId === "string" ? chatId : undefined,
      );
      return jsonResponse(history);
    }

    if (typeof message !== "string" || !message.trim()) {
      return jsonResponse({ error: "`message` must be a non-empty string." }, 400);
    }

    const resolvedChatId = await getOrCreateChatId(
      supabase,
      userId,
      typeof chatId === "string" ? chatId : undefined,
    );

    await saveMessage(supabase, resolvedChatId, "user", message);

    const plan = await planRequest(message, modeHint as ModeHint | undefined);

    let reply = "";
    let mode: "chat" | "financial_query" = "chat";
    let data: unknown = null;

    if (plan.mode === "chat") {
      mode = "chat";
      reply = await generateChatReply(message);
    } else {
      mode = "financial_query";
      const validatedQuery = QueryPlanSchema.parse(plan.query);
      const sql = buildQuery(validatedQuery);

      const { data: sqlData, error } = await supabase.rpc("execute_query", {
        query_text: sql,
      });

      if (error) {
        return jsonResponse({ error }, 500);
      }

      data = sqlData;
      reply = await summarizeFinancialResult(message, sqlData);
    }

    await saveMessage(supabase, resolvedChatId, "assistant", reply);

    return jsonResponse({
      mode,
      reply,
      data,
      chatId: resolvedChatId,
    });
  } catch (err: any) {
    return jsonResponse(
      {
        error: "Request processing failed",
        details: err?.message ?? "Unknown error",
      },
      400,
    );
  }
});
