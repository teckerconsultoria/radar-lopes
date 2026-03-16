// supabase/functions/telegram-webhook/index.ts
import { parseUpdate, sendText, sendVoice, sendPhoto, answerCallbackQuery, getFileUrl } from "./modules/telegram.ts";
import { transcribeVoice } from "./modules/transcription.ts";
import { textToSpeech } from "./modules/tts.ts";
import { processMessage } from "./modules/agent.ts";
import { buscarImoveis, buildSupabaseFilters } from "./modules/search.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAGE_SIZE = 5;

Deno.serve(async (req: Request) => {
  // Validar secret token
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) {
    return new Response("Forbidden", { status: 403 });
  }

  const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
  const WHISPER_KEY = Deno.env.get("WHISPER_API_KEY")!;
  const WHISPER_PROVIDER = (Deno.env.get("WHISPER_PROVIDER") ?? "groq") as "groq" | "openai";
  const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
  const TTS_VOICE = Deno.env.get("TTS_VOICE") ?? "nova";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const parsed = parseUpdate(update);
  if (parsed.type === "unknown") return new Response("OK");

  const chatId = parsed.chatId;

  try {
    // ── Paginação via callback ───────────────────────────────────────────────
    if (parsed.type === "page") {
      await answerCallbackQuery(TOKEN, parsed.callbackId);
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data: conv } = await supabase
        .from("conversations")
        .select("filters")
        .eq("chat_id", chatId)
        .maybeSingle();

      if (conv?.filters) {
        const result = await buscarImoveis(buildSupabaseFilters(conv.filters), SUPABASE_URL, SUPABASE_KEY);
        const page = parsed.page;
        const slice = result.data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        const hasMore = result.data.length > (page + 1) * PAGE_SIZE;
        for (let i = 0; i < slice.length; i++) {
          await sendPhoto(TOKEN, chatId, slice[i] as Parameters<typeof sendPhoto>[2], hasMore && i === slice.length - 1, page);
        }
      }
      return new Response("OK");
    }

    // ── Transcrição de áudio ─────────────────────────────────────────────────
    const isVoice = parsed.type === "voice";
    let userText = "";
    if (isVoice) {
      const fileUrl = await getFileUrl(TOKEN, parsed.fileId);
      userText = await transcribeVoice(fileUrl, WHISPER_KEY, WHISPER_PROVIDER);
    } else {
      userText = parsed.text;
    }

    // ── Processar com agente ─────────────────────────────────────────────────
    const { texto, imoveis, total, autoSendCards } = await processMessage(
      chatId, userText, ANTHROPIC_KEY, SUPABASE_URL, SUPABASE_KEY, isVoice
    );

    if (texto) {
      if (isVoice && OPENAI_KEY) {
        const audio = await textToSpeech(texto, OPENAI_KEY, TTS_VOICE);
        await sendVoice(TOKEN, chatId, audio);
      } else {
        await sendText(TOKEN, chatId, texto);
      }
    }

    if (autoSendCards && imoveis.length > 0) {
      const slice = imoveis.slice(0, PAGE_SIZE);
      const hasMore = total > PAGE_SIZE;
      for (let i = 0; i < slice.length; i++) {
        await sendPhoto(TOKEN, chatId, slice[i] as Parameters<typeof sendPhoto>[2], hasMore && i === slice.length - 1, 0);
      }
    }
  } catch (err) {
    console.error("Erro no webhook:", err instanceof Error ? err.message : String(err));
    await sendText(TOKEN, chatId, "Desculpe, ocorreu um erro. Tente novamente em instantes.");
  }

  return new Response("OK");
});
