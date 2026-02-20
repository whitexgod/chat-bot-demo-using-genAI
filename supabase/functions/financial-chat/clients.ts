import { createClient } from "https://esm.sh/@supabase/supabase-js";

export type SupabaseClient = ReturnType<typeof createClient>;
export type AppRole = "admin" | "user";

export function getOllamaConfig() {
  const baseUrl = Deno.env.get("OLLAMA_BASE_URL");
  const model = Deno.env.get("OLLAMA_MODEL") ?? "financial-chat-assistant";
  const timeoutMsRaw = Deno.env.get("OLLAMA_TIMEOUT_MS");
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 85000;
  const numThreadRaw = Deno.env.get("OLLAMA_NUM_THREAD");
  const numCtxRaw = Deno.env.get("OLLAMA_NUM_CTX");
  const numPredictRaw = Deno.env.get("OLLAMA_NUM_PREDICT");
  const keepAliveRaw = Deno.env.get("OLLAMA_KEEP_ALIVE");

  if (!baseUrl) {
    throw new Error("Missing OLLAMA_BASE_URL");
  }

  const numThread = numThreadRaw ? Number(numThreadRaw) : 6;
  const numCtx = numCtxRaw ? Number(numCtxRaw) : 1024;
  const numPredict = numPredictRaw ? Number(numPredictRaw) : 160;
  const keepAlive = keepAliveRaw ?? "30s";

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 85000,
    numThread: Number.isFinite(numThread) && numThread > 0 ? numThread : 6,
    numCtx: Number.isFinite(numCtx) && numCtx > 0 ? numCtx : 1024,
    numPredict: Number.isFinite(numPredict) && numPredict > 0 ? numPredict : 160,
    keepAlive,
  };
}

export function getAdminClient() {
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

export async function getCurrentUserId(supabase: SupabaseClient, req: Request) {
  const token = getAccessToken(req);
  if (!token) throw new Error("Missing bearer token");

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid JWT");
  return data.user.id;
}

export async function getUserRole(supabase: SupabaseClient, userId: string): Promise<AppRole> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role === "admin" ? "admin" : "user";
}
