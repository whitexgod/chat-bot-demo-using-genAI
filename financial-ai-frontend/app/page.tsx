"use client";

import { useEffect, useState } from "react";
import {
  clearSavedCredentials,
  getRememberMePreference,
  getSavedCredentials,
  getSupabase,
  setSavedCredentials,
  setRememberMePreference,
} from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { ErrorToast } from "@/components/error-toast";

export default function Home() {
  const router = useRouter();
  const [savedCredentials] = useState(() => {
    if (typeof window === "undefined") return null;
    return getSavedCredentials();
  });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState(() => savedCredentials?.email ?? "");
  const [password, setPassword] = useState(() => savedCredentials?.password ?? "");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => {
    if (typeof window === "undefined") return true;
    if (savedCredentials) return true;
    return getRememberMePreference();
  });
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    const savedTheme = localStorage.getItem("theme");
    const nextTheme =
      savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
    document.documentElement.setAttribute("data-theme", nextTheme);

    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!mounted) return;
        if (data.session) {
          router.replace("/chat");
        }
      });

    return () => {
      mounted = false;
    };
  }, [router]);

  const handleLogin = async () => {
    if (!email || !password || loading) return;

    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    setRememberMePreference(rememberMe);
    const { error } = await getSupabase().auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMessage(error.message);
    } else {
      if (rememberMe) {
        setSavedCredentials({ email, password });
      } else {
        clearSavedCredentials();
      }
      router.replace("/chat");
    }
    setLoading(false);
  };

  const handleRegister = async () => {
    if (!email || !password || loading) return;
    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName.trim(),
        },
      },
    });

    if (error) {
      setErrorMessage(error.message);
    } else if (data.session) {
      router.replace("/chat");
    } else {
      setSuccessMessage("Account created. Check your email to confirm your account.");
    }

    setLoading(false);
  };

  const handleSubmit = async () => {
    if (mode === "signin") {
      await handleLogin();
      return;
    }

    await handleRegister();
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-10 sm:px-8">
      <ErrorToast message={errorMessage} onClose={() => setErrorMessage("")} />
      <section className="glass-card fade-in-up w-full max-w-md rounded-3xl px-6 py-8 sm:px-8 sm:py-10">
        <p className="mb-2 text-sm uppercase tracking-[0.18em] text-[var(--muted)]">
          Financial AI
        </p>
        <h1 className="mb-2 text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mb-8 text-sm text-[var(--muted)]">
          {mode === "signin"
            ? "Sign in to continue your financial conversations."
            : "Set up an account to start using your financial assistant."}
        </p>

        <div className="space-y-4">
          {mode === "signup" ? (
            <input
              type="text"
              className="w-full rounded-xl border border-[var(--surface-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-cyan-300/70 focus:outline-none"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          ) : null}

          <input
            type="email"
            className="w-full rounded-xl border border-[var(--surface-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-cyan-300/70 focus:outline-none"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            className="w-full rounded-xl border border-[var(--surface-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-cyan-300/70 focus:outline-none"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {mode === "signup" ? (
            <input
              type="password"
              className="w-full rounded-xl border border-[var(--surface-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-cyan-300/70 focus:outline-none"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          ) : null}

          {mode === "signin" ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--muted)]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border border-[var(--surface-border)] bg-[var(--input-bg)]"
                checked={rememberMe}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setRememberMe(checked);
                  setRememberMePreference(checked);
                  if (!checked) {
                    clearSavedCredentials();
                  }
                }}
              />
              Remember me
            </label>
          ) : null}

          {successMessage ? (
            <p className="rounded-lg border border-emerald-300/50 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
              {successMessage}
            </p>
          ) : null}

          <button
            className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-3 text-sm font-medium text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading
              ? "Processing..."
              : mode === "signin"
                ? "Login"
                : "Create account"}
          </button>

          <button
            className="w-full rounded-xl border border-[var(--surface-border)] bg-[var(--input-bg)] px-4 py-3 text-sm font-medium text-[var(--foreground)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              setMode((prev) => (prev === "signin" ? "signup" : "signin"));
              setErrorMessage("");
              setSuccessMessage("");
            }}
            disabled={loading}
          >
            {mode === "signin"
              ? "Need an account? Create one"
              : "Already have an account? Login"}
          </button>
        </div>
      </section>
    </main>
  );
}
