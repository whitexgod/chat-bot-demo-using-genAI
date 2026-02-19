import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { GoogleGenAI } from "npm:@google/genai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  return token;
}

async function validateRequestJWT(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, reason: "Missing Bearer token" };

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SB_PUBLISHABLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const apiKey = publishableKey ?? anonKey;

  if (!supabaseUrl || !apiKey) {
    return { ok: false as const, reason: "Missing Supabase auth config" };
  }

  const supabase = createClient(supabaseUrl, apiKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return { ok: false as const, reason: error?.message ?? "Invalid JWT" };
  }

  return { ok: true as const, userId: data.user.id };
}

async function chatWithGemini(message: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const client = new GoogleGenAI({ apiKey });
  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
You are a helpful financial assistant chatbot.
Respond in markdown.

User message:
${message}
`,
    config: {
      temperature: 0.3,
    },
  });

  return response.text?.trim() || "I could not generate a response.";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await validateRequestJWT(req);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ error: "Invalid JWT", details: auth.reason }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const { message } = await req.json();

    if (typeof message !== "string" || !message.trim()) {
      return new Response(
        JSON.stringify({ error: "`message` must be a non-empty string." }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const reply = await chatWithGemini(message);

    return new Response(JSON.stringify({ reply }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: "Chat request failed",
        details: err?.message ?? "Unknown error",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
