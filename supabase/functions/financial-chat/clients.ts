import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { GoogleGenAI } from "npm:@google/genai";

export type SupabaseClient = ReturnType<typeof createClient>;
export type AppRole = "admin" | "user";

export function getGeminiClient() {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  return new GoogleGenAI({ apiKey });
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
