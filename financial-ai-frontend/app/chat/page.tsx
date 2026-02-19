"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type ChatResponse = string;
type ChatTab = "chat" | "financial";

export default function Chat() {
  const router = useRouter();
  const [userDisplayName, setUserDisplayName] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    const savedTheme = localStorage.getItem("theme");
    return savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : "dark";
  });
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<ChatTab>("chat");
  const [responsesByTab, setResponsesByTab] = useState<
    Record<ChatTab, ChatResponse[]>
  >({
    chat: [],
    financial: [],
  });
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [requestError, setRequestError] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;

    getSupabase()
      .auth.getSession()
      .then(async ({ data }) => {
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

    const functionName = activeTab === "chat" ? "chat-bot" : "financial-chat";

    const invokeFunction = async (accessToken: string) => {
      supabase.functions.setAuth(accessToken);
      return supabase.functions.invoke(functionName, {
        body: { message },
      });
    };

    let { data, error } = await invokeFunction(session.access_token);

    if (error?.message?.toLowerCase().includes("invalid jwt")) {
      const { data: refreshed, error: refreshError } =
        await supabase.auth.refreshSession();
      const refreshedToken = refreshed.session?.access_token;

      if (!refreshError && refreshedToken) {
        ({ data, error } = await invokeFunction(refreshedToken));
      }

      if (error?.message?.toLowerCase().includes("invalid jwt")) {
        setRequestError(
          "Authentication token is invalid. Please log out and sign in again.",
        );
        setLoading(false);
        return;
      }
    }

    if (!error) {
      const reply =
        typeof data?.reply === "string"
          ? data.reply
          : typeof data === "string"
            ? data
            : JSON.stringify(data);
      setResponsesByTab((prev) => ({
        ...prev,
        [activeTab]: [...prev[activeTab], reply],
      }));
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

  const activeResponses = responsesByTab[activeTab];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-8 sm:px-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-(--muted)">
            Financial AI
          </p>
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Smart Money Assistant
          </h1>
          {userDisplayName ? (
            <p className="mt-1 text-xs text-(--muted)">
              Signed in as {userDisplayName}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-lg border border-(--surface-border) bg-(--input-bg) px-3 py-2 text-xs font-medium text-foreground transition hover:brightness-110"
            onClick={toggleTheme}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            className="rounded-lg border border-(--surface-border) bg-(--input-bg) px-3 py-2 text-xs font-medium text-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </div>

      <section className="glass-card flex min-h-[72vh] flex-1 flex-col rounded-3xl p-4 sm:p-6">
        <div className="mb-4 flex gap-2">
          <button
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
              activeTab === "chat"
                ? "border-cyan-300/70 bg-cyan-400/20 text-foreground"
                : "border-(--surface-border) bg-(--input-bg) text-foreground hover:brightness-110"
            }`}
            onClick={() => {
              setActiveTab("chat");
              setRequestError("");
            }}
          >
            Normal Chat
          </button>
          <button
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
              activeTab === "financial"
                ? "border-cyan-300/70 bg-cyan-400/20 text-foreground"
                : "border-(--surface-border) bg-(--input-bg) text-foreground hover:brightness-110"
            }`}
            onClick={() => {
              setActiveTab("financial");
              setRequestError("");
            }}
          >
            Financial Query
          </button>
        </div>

        <div className="chat-scroll mb-4 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-(--surface-border) bg-(--chat-bg) p-4">
          {activeResponses.length === 0 ? (
            <p className="text-sm text-(--muted)">
              {activeTab === "chat"
                ? "Ask anything to chat with the bot."
                : "Ask about spending, totals, categories, or financial records."}
            </p>
          ) : (
            activeResponses.map((res, index) => (
              <div
                key={index}
                className="fade-in-up max-w-[92%] rounded-2xl border border-(--surface-border) bg-(--chip-bg) px-4 py-3 text-sm text-foreground"
              >
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-(--muted)">
                  AI Insight
                </p>
                <p className="whitespace-pre-wrap wrap-break-word text-sm text-foreground">
                  {res}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="w-full rounded-xl border border-(--surface-border) bg-(--input-bg) px-4 py-3 text-sm text-foreground placeholder:text-(--muted) focus:border-cyan-300/70 focus:outline-none"
            placeholder={
              activeTab === "chat"
                ? "Message the bot..."
                : "Ask about your financial data..."
            }
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendMessage();
              }
            }}
          />

          <button
            className="rounded-xl bg-linear-to-r from-cyan-400 to-blue-500 px-6 py-3 text-sm font-medium text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
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
