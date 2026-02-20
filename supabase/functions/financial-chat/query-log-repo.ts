import type { AppRole, SupabaseClient } from "./clients.ts";

type CreateAiQueryLogInput = {
  userId: string;
  role: AppRole;
  chatId: string;
  userMessage: string;
  planner: unknown;
  parsedQuery: unknown;
  sqlText: string;
};

export async function createAiQueryLog(
  supabase: SupabaseClient,
  input: CreateAiQueryLogInput,
) {
  const { data, error } = await supabase
    .from("ai_query_logs")
    .insert({
      user_id: input.userId,
      role: input.role,
      chat_id: input.chatId,
      user_message: input.userMessage,
      planner: input.planner,
      parsed_query: input.parsedQuery,
      sql_text: input.sqlText,
      status: "generated",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function markAiQueryLogSuccess(
  supabase: SupabaseClient,
  id: string,
  rowCount: number | null,
  durationMs: number,
) {
  const { error } = await supabase
    .from("ai_query_logs")
    .update({
      status: "success",
      row_count: rowCount,
      duration_ms: durationMs,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw error;
}

export async function markAiQueryLogError(
  supabase: SupabaseClient,
  id: string,
  errorMessage: string,
  durationMs: number,
) {
  const { error } = await supabase
    .from("ai_query_logs")
    .update({
      status: "error",
      error_message: errorMessage.slice(0, 2000),
      duration_ms: durationMs,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) throw error;
}
