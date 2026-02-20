import { serve } from "https://deno.land/std/http/server.ts";
import { generateChatReply, planRequest, summarizeFinancialResult } from "./ai.ts";
import { getCurrentUserId, getAdminClient, getUserRole } from "./clients.ts";
import { getOrCreateChatId, loadHistory, saveMessage } from "./chat-repo.ts";
import { corsHeaders, jsonResponse } from "./http.ts";
import { buildQuery } from "./query-builder.ts";
import {
  createAiQueryLog,
  markAiQueryLogError,
  markAiQueryLogSuccess,
} from "./query-log-repo.ts";
import { QueryPlanSchema, type ModeHint } from "./schemas.ts";

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
      const sql = buildQuery(validatedQuery, {
        requesterUserId: userId,
        isAdmin,
      });
      const startedAt = Date.now();
      let logId: string | null = null;

      try {
        logId = await createAiQueryLog(supabase, {
          userId,
          role,
          chatId: resolvedChatId,
          userMessage: message,
          planner: plan,
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
        return jsonResponse({ error }, 500);
      }

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
