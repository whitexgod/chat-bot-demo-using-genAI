import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const REMEMBER_ME_KEY = "remember_me";
const SAVED_LOGIN_KEY = "saved_login_credentials";

let persistentClient: SupabaseClient | undefined;
let sessionClient: SupabaseClient | undefined;

const createBrowserClient = (storage: Storage): SupabaseClient =>
  createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage,
    },
  });

export const getRememberMePreference = () => {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(REMEMBER_ME_KEY);
  return stored === null ? true : stored === "true";
};

export const setRememberMePreference = (rememberMe: boolean) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(REMEMBER_ME_KEY, String(rememberMe));
};

type SavedCredentials = {
  email: string;
  password: string;
};

export const getSavedCredentials = (): SavedCredentials | null => {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SAVED_LOGIN_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SavedCredentials>;
    if (typeof parsed.email !== "string" || typeof parsed.password !== "string") {
      return null;
    }
    return {
      email: parsed.email,
      password: parsed.password,
    };
  } catch {
    return null;
  }
};

export const setSavedCredentials = (credentials: SavedCredentials) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(SAVED_LOGIN_KEY, JSON.stringify(credentials));
};

export const clearSavedCredentials = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SAVED_LOGIN_KEY);
};

export const getSupabase = (): SupabaseClient => {
  if (typeof window === "undefined") {
    return createClient(supabaseUrl, supabaseKey);
  }

  if (getRememberMePreference()) {
    if (!persistentClient) {
      persistentClient = createBrowserClient(localStorage);
    }
    return persistentClient;
  }

  if (!sessionClient) {
    sessionClient = createBrowserClient(sessionStorage);
  }
  return sessionClient;
};
