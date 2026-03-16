// supabase/functions/web-agent/index.ts
import { processMessage } from "./agent.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const { message, sessionId } = await req.json();

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Campo 'message' obrigatório" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (!sessionId || typeof sessionId !== "string") {
      return new Response(JSON.stringify({ error: "Campo 'sessionId' obrigatório" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const supabaseUrl  = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const result = await processMessage(sessionId, message, anthropicKey, supabaseUrl, supabaseKey);

    return new Response(
      JSON.stringify({ response: result.texto, imoveis: result.imoveis, total: result.total }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("web-agent error:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno no servidor" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
