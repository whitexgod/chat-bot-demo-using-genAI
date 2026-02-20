import { getOllamaConfig } from "./clients.ts";
import { PlannerSchema, type ModeHint } from "./schemas.ts";

const BASE_SYSTEM_PROMPT = `
You are the SQL planning and financial assistant model for a Supabase app.

Database schema:
- public.transactions(id uuid, user_id uuid, amount numeric, debit numeric, credit numeric, category text, merchant text, date date, created_at timestamptz)
- public.profiles(id uuid, role app_role, created_at timestamptz)
- public.chats(id uuid, user_id uuid, created_at timestamptz)
- public.messages(id uuid, chat_id uuid, role text, content text, created_at timestamptz)
- public.ai_query_logs(id uuid, user_id uuid, role app_role, chat_id uuid, status text, row_count integer, duration_ms integer, started_at timestamptz, finished_at timestamptz, created_at timestamptz)

Security and query rules:
- SQL must always be a single SELECT statement.
- Never generate INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, GRANT, REVOKE, COPY.
- LIMIT must be <= 500.
- Admin users may query any table.
- Non-admin users may query only public.transactions.
- For non-admin users, SQL must include: user_id = '<requester_user_id>'::uuid
- For all user-facing responses, use Indian Rupees (INR) and the ₹ symbol. Never use $ or USD.

When asked for planner output, return strict JSON only with this shape:
{
  "mode": "chat" | "financial_query",
  "query": { "sql": "SELECT ..." }
}
No markdown. No extra keys.
`.trim();

async function runOllamaPrompt(
  prompt: string,
  options?: {
    temperature?: number;
    json?: boolean;
    numPredict?: number;
    retries?: number;
    numCtx?: number;
    keepAlive?: string;
    systemPrompt?: string;
  },
) {
  const { baseUrl, model, timeoutMs, numThread, numCtx, numPredict, keepAlive } =
    getOllamaConfig();
  const retries = options?.retries ?? 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          prompt,
          system: options?.systemPrompt ?? BASE_SYSTEM_PROMPT,
          stream: false,
          keep_alive: options?.keepAlive ?? keepAlive,
          ...(options?.json ? { format: "json" } : {}),
          options: {
            temperature: options?.temperature ?? 0.2,
            num_predict: options?.numPredict ?? numPredict,
            num_ctx: options?.numCtx ?? numCtx,
            num_thread: numThread,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        if (text.includes("Error code 524")) {
          throw new Error(
            "Ollama tunnel timed out (Cloudflare 524). Use a smaller model or shorter prompt, and keep tunnel stable.",
          );
        }
        throw new Error(`Ollama request failed (${response.status}): ${text}`);
      }

      const payload = await response.json();
      const text = typeof payload?.response === "string" ? payload.response.trim() : "";
      if (!text) throw new Error("Ollama returned empty response.");
      return text;
    } catch (error: any) {
      const isAbort = error?.name === "AbortError" || String(error?.message).includes("timeout");
      lastError = isAbort
        ? new Error(`Ollama request timed out after ${timeoutMs}ms.`)
        : error instanceof Error
          ? error
          : new Error(String(error));

      if (attempt >= retries) break;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Ollama request failed.");
}

function normalizeToINR(text: string) {
  return text
    .replace(/\bUSD\b/gi, "INR")
    .replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g, "₹$1");
}

export async function planRequest(
  message: string,
  modeHint?: ModeHint,
  isAdmin = false,
  requesterUserId?: string,
) {
  const plannerSystemPrompt = `${BASE_SYSTEM_PROMPT}
Requester role: ${isAdmin ? "admin" : "user"}
Requester user id: ${requesterUserId ?? "unknown"}
Mode hint: ${modeHint ?? "none"}`;

  const responseText = await runOllamaPrompt(
    `
Classify the user request and return only valid JSON.
No markdown.
No explanation.

Allowed modes:
- chat: normal conversation or advice that does not require DB querying.
- financial_query: generate a read-only SQL query.

If mode is financial_query, include query object:
{
  "sql": "single SELECT statement"
}

User message: ${message}
`,
    {
      temperature: 0,
      json: true,
      numPredict: 180,
      retries: 1,
      systemPrompt: plannerSystemPrompt,
    },
  );

  const parsed = JSON.parse(responseText || "{}");
  return PlannerSchema.parse(parsed);
}

export async function generateChatReply(message: string) {
  const output = await runOllamaPrompt(
    `
You are a helpful financial assistant.
Respond in clear markdown.
Keep it concise and practical.
Use Indian Rupees (INR) for all monetary values only.
Never use USD or $.
Always format money with the ₹ symbol.

User message:
${message}
`,
    { temperature: 0.3, numPredict: 220, retries: 1 },
  );
  return normalizeToINR(output);
}

export async function summarizeFinancialResult(message: string, sqlData: unknown) {
  const rows = Array.isArray(sqlData) ? sqlData : [];
  const compactRows = rows.slice(0, 20).map((row) => {
    if (!row || typeof row !== "object") return row;
    const entries = Object.entries(row as Record<string, unknown>).slice(0, 8);
    return Object.fromEntries(entries);
  });
  const compactPayload = {
    row_count: rows.length,
    sample_rows: compactRows,
  };

  const output = await runOllamaPrompt(
    `
You are a financial assistant.
Given DB results, answer the user in Markdown only.
Return valid Markdown (no plain text-only response).
Use this format:
- A short heading
- A concise summary bullet list
- A Markdown table if tabular data is present
If no rows, clearly say no matching records were found.
Use Indian Rupees (INR) for all monetary values only.
Never use USD or $.
Always format money with the ₹ symbol.

User message:
${message}

DB result JSON:
${JSON.stringify(compactPayload)}
`,
    {
      temperature: 0.1,
      numPredict: 96,
      numCtx: 768,
      retries: 0,
      keepAlive: "15s",
    },
  );
  return normalizeToINR(output);
}
