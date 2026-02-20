import type { SupabaseClient } from "./clients.ts";

export async function validateChatOwnership(
  supabase: SupabaseClient,
  userId: string,
  chatId: string,
  isAdmin = false,
) {
  let query = supabase.from("chats").select("id").eq("id", chatId);
  if (!isAdmin) {
    query = query.eq("user_id", userId);
  }
  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

export async function getOrCreateChatId(
  supabase: SupabaseClient,
  userId: string,
  chatId?: string,
  isAdmin = false,
) {
  if (chatId) {
    const isOwner = await validateChatOwnership(supabase, userId, chatId, isAdmin);
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

export async function saveMessage(
  supabase: SupabaseClient,
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

export async function loadHistory(
  supabase: SupabaseClient,
  userId: string,
  chatId?: string,
  isAdmin = false,
) {
  if (!chatId) return { chatId: null, messages: [] as Array<{ role: string; content: string }> };

  const isOwner = await validateChatOwnership(supabase, userId, chatId, isAdmin);
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
