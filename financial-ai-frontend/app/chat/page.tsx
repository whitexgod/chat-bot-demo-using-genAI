"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type ResponseMode = "chat" | "financial_query";
type ChatResponse = {
  reply: string;
  mode: ResponseMode;
};
type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
  mode?: ResponseMode;
};
type FunctionHistoryMessage = {
  role?: unknown;
  content?: unknown;
};

const chatSessionKey = "financial_ai_chat_id";

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(line: string) {
  const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = normalized.split("|").map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function renderMessageContent(content: string): ReactNode {
  const lines = content.split("\n");
  let separatorIndex = -1;

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i - 1].includes("|") && isSeparatorRow(lines[i])) {
      separatorIndex = i;
      break;
    }
  }

  if (separatorIndex === -1) {
    return <span>{renderInlineMarkdown(content)}</span>;
  }

  const headerIndex = separatorIndex - 1;
  const headers = parseTableRow(lines[headerIndex]);
  const rows: string[][] = [];
  let endIndex = separatorIndex + 1;

  while (endIndex < lines.length && lines[endIndex].includes("|")) {
    rows.push(parseTableRow(lines[endIndex]));
    endIndex += 1;
  }

  const before = lines.slice(0, headerIndex).join("\n").trim();
  const after = lines.slice(endIndex).join("\n").trim();

  return (
    <div className="space-y-3">
      {before ? <p>{renderInlineMarkdown(before)}</p> : null}
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse rounded-lg border border-[var(--surface-border)] text-left text-sm">
          <thead>
            <tr>
              {headers.map((header, idx) => (
                <th key={idx} className="border-b border-[var(--surface-border)] px-3 py-2">
                  {renderInlineMarkdown(header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx} className="border-b border-[var(--surface-border)] px-3 py-2">
                    {renderInlineMarkdown(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {after ? <p>{renderInlineMarkdown(after)}</p> : null}
    </div>
  );
}

export default function Chat() {
  const router = useRouter();
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [userDisplayName, setUserDisplayName] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    const savedTheme = localStorage.getItem("theme");
    return savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
  });
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [chatId, setChatId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(chatSessionKey);
  });
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [requestError, setRequestError] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;

    getSupabase().auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        router.replace("/");
        return;
      }

      const metadataName =
        typeof data.session.user.user_metadata?.display_name === "string"
          ? data.session.user.user_metadata.display_name
          : "";

      if (metadataName) {
        setUserDisplayName(metadataName);
      } else {
        setUserDisplayName(data.session.user.email ?? "");
      }

    });

    return () => {
      mounted = false;
    };
  }, [router]);

  const loadHistory = async () => {
    const currentChatId = chatId;
    if (!currentChatId) {
      setMessages([]);
      return;
    }

    const supabase = getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) return;

    const { data, error } = await supabase.functions.invoke("financial-chat", {
      body: {
        action: "history",
        chatId: currentChatId,
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (error) {
      setRequestError(error.message);
      return;
    }

    const history: FunctionHistoryMessage[] = Array.isArray(data?.messages)
      ? (data.messages as FunctionHistoryMessage[])
      : [];
    setMessages(
      history.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    );
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async () => {
    if (!message.trim() || loading) return;

    setLoading(true);
    setRequestError("");

    const supabase = getSupabase();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      setRequestError("Session expired. Please sign in again.");
      setLoading(false);
      router.replace("/");
      return;
    }

    const { data, error } = await supabase.functions.invoke("financial-chat", {
      body: {
        message,
        chatId,
      },
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const userMessage = message;

    if (!error) {
      const parsed = data as ChatResponse & { chatId?: string };
      const replyText =
        typeof data?.reply === "string"
          ? data.reply
          : typeof data === "string"
            ? data
            : JSON.stringify(data);
      const mode: ResponseMode =
        data?.mode === "financial_query" ? "financial_query" : "chat";

      setMessages((prev) => [
        ...prev,
        { role: "user", content: userMessage },
        { role: "assistant", content: replyText, mode },
      ]);

      if (parsed.chatId && parsed.chatId !== chatId) {
        setChatId(parsed.chatId);
        sessionStorage.setItem(chatSessionKey, parsed.chatId);
      }
    } else {
      setRequestError(error.message);
    }

    setMessage("");
    setLoading(false);
  };

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await getSupabase().auth.signOut();
    router.replace("/");
    setLoggingOut(false);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Financial AI</p>
          <h1 className="text-2xl font-semibold text-[var(--foreground)] sm:text-3xl">
            Smart Money Assistant
          </h1>
          {userDisplayName ? (
            <p className="mt-1 text-xs text-[var(--muted)]">Signed in as {userDisplayName}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-[var(--surface-border)] bg-[var(--input-bg)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition hover:brightness-110"
            onClick={toggleTheme}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            className="rounded-lg border border-[var(--surface-border)] bg-[var(--input-bg)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </div>

      <section className="glass-card flex min-h-[72vh] flex-1 flex-col rounded-3xl p-4 sm:p-6">
        <div
          ref={chatScrollRef}
          className="chat-scroll mb-4 h-[65vh] overflow-y-auto rounded-2xl border border-[var(--surface-border)] bg-[var(--chat-bg)] p-4"
        >
          <div className="flex min-h-full flex-col justify-end gap-3">
            {messages.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Ask anything about your money and records.</p>
            ) : (
              messages.map((msg, index) => (
                <div
                  key={index}
                  className={`fade-in-up max-w-[92%] rounded-2xl border px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "ml-auto border-cyan-300/40 bg-cyan-400/10 text-[var(--foreground)]"
                      : "border-[var(--surface-border)] bg-[var(--chip-bg)] text-[var(--foreground)]"
                  }`}
                >
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                    {msg.role === "user"
                      ? "You"
                      : msg.mode === "financial_query"
                        ? "Financial Insight"
                        : "Assistant Reply"}
                  </p>
                  <div className="whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">
                    {renderMessageContent(msg.content)}
                  </div>
                </div>
              ))
            )}

            {loading ? (
              <div className="fade-in-up max-w-[92%] rounded-2xl border border-[var(--surface-border)] bg-[var(--chip-bg)] px-4 py-3 text-sm text-[var(--foreground)]">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  Assistant Reply
                </p>
                <div className="thinking-loader">
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="w-full rounded-xl border border-[var(--surface-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-cyan-300/70 focus:outline-none"
            placeholder="Ask about your expenses, totals, budgets, or anything else..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendMessage();
              }
            }}
          />

          <button
            className="rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-medium text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={sendMessage}
            disabled={loading}
          >
            {loading ? "Thinking..." : "Send"}
          </button>
        </div>
        {requestError ? (
          <p className="mt-3 rounded-lg border border-rose-300/50 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
            {requestError}
          </p>
        ) : null}
      </section>
    </main>
  );
}
