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

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const cleaned = value.replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatINRCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function escapeMarkdownCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function toObjectRows(sqlData: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(sqlData)) return [];
  return sqlData.map((row, index) => {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      return row as Record<string, unknown>;
    }
    return { row_index: index + 1, value: row };
  });
}

function buildMarkdownTable(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return "";

  const headers = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row))),
  );
  if (headers.length === 0) return "";

  const headerRow = `| ${headers.join(" | ")} |`;
  const sepRow = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyRows = rows.map((row) => {
    const cells = headers.map((key) => escapeMarkdownCell(row[key]));
    return `| ${cells.join(" | ")} |`;
  });

  return [headerRow, sepRow, ...bodyRows].join("\n");
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
  const rows = toObjectRows(sqlData);
  if (rows.length === 0) {
    return [
      "### Financial Data Summary",
      "",
      "- Request: " + message,
      "- No matching records were found.",
    ].join("\n");
  }

  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const totals: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const numericValue = coerceNumber(value);
      if (numericValue === null) continue;
      totals[key] = (totals[key] ?? 0) + numericValue;
    }
  }

  const keyTotals = ["amount", "debit", "credit"]
    .filter((key) => key in totals)
    .map((key) => `- Total ${key}: ${formatINRCurrency(totals[key])}`);

  const fallbackTotals = keyTotals.length
    ? []
    : Object.entries(totals)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 3)
      .map(([key, value]) => `- Total ${key}: ${value.toLocaleString("en-IN")}`);

  const summary = [
    "### Financial Data Summary",
    "",
    `- Request: ${message}`,
    `- Rows returned: ${rows.length}`,
    `- Columns returned: ${headers.join(", ") || "none"}`,
    ...keyTotals,
    ...fallbackTotals,
    "",
    "### Full Result Set",
    "",
    buildMarkdownTable(rows),
  ].join("\n");

  return normalizeToINR(summary);
}
