import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { GoogleGenAI } from "npm:@google/genai";
import { z } from "npm:zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ===============================
// 1️⃣ Define Query Spec Schema
// ===============================
const QuerySpecSchema = z.object({
  metric: z.enum(["sum", "avg", "count"]),
  column: z.literal("amount"),
  group_by: z.enum(["category", "merchant"]).nullable(),
});

// ===============================
// 2️⃣ Controlled Query Builder
// ===============================
function buildQuery(spec: any) {
  let selectClause =
    spec.metric === "count"
      ? "COUNT(*)"
      : `${spec.metric.toUpperCase()}(${spec.column})`;

  let groupClause = "";

  if (spec.group_by) {
    selectClause = `${spec.group_by}, ${selectClause}`;
    groupClause = `GROUP BY ${spec.group_by}`;
  }

  const sql = `
    SELECT ${selectClause}
    FROM transactions
    WHERE true
    ${groupClause}
    LIMIT 500
  `;

  return sql;
}

// ===============================
// 3️⃣ Gemini Call via GoogleGenAI
// ===============================
async function callGemini(message: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const client = new GoogleGenAI({ apiKey });

  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `
You are a financial query parser.

Return ONLY valid JSON.
No explanations.
No markdown.

Schema:
{
  "metric": "sum" | "avg" | "count",
  "column": "amount",
  "group_by": "category" | "merchant" | null
}

User message:
${message}
`,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  });

  return JSON.parse(response.text ?? "{}");
}

// ===============================
// 4️⃣ Edge Function Entry
// ===============================
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message } = await req.json();

    const parsed = await callGemini(message);

    // Validate with Zod (VERY IMPORTANT)
    const spec = QuerySpecSchema.parse(parsed);

    const sql = buildQuery(spec);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase.rpc("execute_query", {
      query_text: sql,
    });

    if (error) {
      return new Response(JSON.stringify({ error }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: "Query processing failed",
        details: err.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
