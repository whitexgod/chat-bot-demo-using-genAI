import { serve } from "https://deno.land/std/http/server.ts";
import { generateChatReply, planRequest, summarizeFinancialResult } from "./ai.ts";
import { getCurrentUserId, getAdminClient, getUserRole } from "./clients.ts";
import { getOrCreateChatId, loadHistory, saveMessage } from "./chat-repo.ts";
import { corsHeaders, jsonResponse } from "./http.ts";
import {
  createAiQueryLog,
  markAiQueryLogError,
  markAiQueryLogSuccess,
} from "./query-log-repo.ts";
import { QueryPlanSchema, type ModeHint } from "./schemas.ts";

function normalizeSql(sql: string) {
  return sql.trim().replace(/;+\s*$/, "");
}

function ensureSingleSelect(sql: string) {
  const normalized = normalizeSql(sql);
  const lower = normalized.toLowerCase();
  if (!lower.startsWith("select ")) {
    throw new Error("Only SELECT queries are allowed.");
  }
  if (/[;]+/.test(normalized)) {
    throw new Error("Multiple statements are not allowed.");
  }
  const banned = ["insert ", "update ", "delete ", "drop ", "alter ", "truncate ", "create "];
  if (banned.some((keyword) => lower.includes(keyword))) {
    throw new Error("Mutation or DDL SQL is not allowed.");
  }
  return normalized;
}

function enforceRoleScope(sql: string, userId: string, isAdmin: boolean) {
  if (isAdmin) return sql;

  const lower = sql.toLowerCase();
  if (!lower.includes(" from public.transactions")) {
    throw new Error("Non-admin users can query only public.transactions.");
  }

  const escapedUserId = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const scopePattern = new RegExp(
    `\\buser_id\\b\\s*=\\s*'${escapedUserId}'(?:\\s*::\\s*uuid)?`,
    "i",
  );
  if (!scopePattern.test(sql)) {
    throw new Error("Non-admin SQL must include own user_id scope.");
  }

  return sql;
}

function formatFinancialData(sqlData: unknown) {
  if (!Array.isArray(sqlData) || sqlData.length === 0) {
    return "### Financial Data\n\nNo matching records were found.";
  }

  const rows = sqlData as Array<Record<string, unknown>>;
  const firstRow = rows[0] ?? {};
  const headers = Object.keys(firstRow);

  if (headers.length === 0) {
    return `### Financial Data\n\nReturned rows: ${rows.length}`;
  }

  const headerRow = `| ${headers.join(" | ")} |`;
  const sepRow = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyRows = rows.map((row) => {
    const cells = headers.map((key) => {
      const value = row[key];
      if (value === null || value === undefined) return "";
      return String(value).replace(/\|/g, "\\|");
    });
    return `| ${cells.join(" | ")} |`;
  });

  return [
    "### Financial Data",
    "",
    `Returned rows: ${rows.length}`,
    "",
    headerRow,
    sepRow,
    ...bodyRows,
  ].join("\n");
}

function formatFinancialError(message: string) {
  return [
    "### Financial Data",
    "",
    "No data could be returned for this request.",
    "",
    `Reason: ${message}`,
  ].join("\n");
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
    const role = await getUserRole(supabase, userId);
    const isAdmin = role === "admin";

    if (action === "history") {
      const history = await loadHistory(
        supabase,
        userId,
        typeof chatId === "string" ? chatId : undefined,
        isAdmin,
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
      isAdmin,
    );

    await saveMessage(supabase, resolvedChatId, "user", message);

    let reply = "";
    let mode: "chat" | "financial_query" = "chat";
    let data: unknown = null;
    let plan: Awaited<ReturnType<typeof planRequest>> | null = null;

    // If UI explicitly requests chat mode, skip planner entirely.
    if (modeHint !== "chat") {
      try {
        plan = await planRequest(
          message,
          modeHint as ModeHint | undefined,
          isAdmin,
          userId,
        );
        mode = plan.mode;
      } catch (plannerError: any) {
        mode = "financial_query";
        data = [];
        reply = formatFinancialError(plannerError?.message ?? "Planner failed");
      }
    }

    if (mode === "chat" && !reply) {
      reply = await generateChatReply(message);
    } else {
      if (!plan?.query?.sql) {
        data = [];
        reply = reply || formatFinancialError("Model did not provide SQL for financial query mode.");
      } else {
        const validatedQuery = QueryPlanSchema.parse(plan.query);
        const sql = enforceRoleScope(ensureSingleSelect(validatedQuery.sql), userId, isAdmin);
        const startedAt = Date.now();
        let logId: string | null = null;

        try {
          logId = await createAiQueryLog(supabase, {
            userId,
            role,
            chatId: resolvedChatId,
            userMessage: message,
            planner: plan,
            parsedQuery: validatedQuery,
            sqlText: sql,
          });
        } catch (logError) {
          console.error("ai_query_logs insert failed", logError);
        }

        const { data: sqlData, error } = await supabase.rpc("execute_query", {
          query_text: sql,
        });

        if (error) {
          if (logId) {
            try {
              await markAiQueryLogError(
                supabase,
                logId,
                error.message ?? "execute_query failed",
                Date.now() - startedAt,
              );
            } catch (logError) {
              console.error("ai_query_logs error update failed", logError);
            }
          }
          data = [];
          reply = formatFinancialError(error.message ?? "Query execution failed");
        } else {
          if (logId) {
            try {
              await markAiQueryLogSuccess(
                supabase,
                logId,
                Array.isArray(sqlData) ? sqlData.length : null,
                Date.now() - startedAt,
              );
            } catch (logError) {
              console.error("ai_query_logs success update failed", logError);
            }
          }

          data = sqlData;
          try {
            const summary = await summarizeFinancialResult(message, sqlData);
            const fullTable = formatFinancialData(sqlData);
            reply = `${summary}\n\n---\n\n${fullTable}`;
          } catch (summarizeError) {
            console.error("summarizeFinancialResult failed, using table fallback", summarizeError);
            reply = formatFinancialData(sqlData);
          }
        }
      }
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
