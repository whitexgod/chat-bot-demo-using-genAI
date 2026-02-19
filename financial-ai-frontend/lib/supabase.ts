import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const REMEMBER_ME_KEY = "remember_me";

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
