// supabase/functions/telegram-webhook/modules/telegram.ts

const TELEGRAM_API = "https://api.telegram.org";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type ParsedUpdate =
  | { type: "text";  chatId: number; text: string }
  | { type: "voice"; chatId: number; fileId: string }
  | { type: "page";  chatId: number; page: number; callbackId: string }
  | { type: "unknown" };

export interface Imovel {
  url: string;
  titulo: string;
  tipo: string | null;
  bairro: string | null;
  preco: number | null;
  area_m2: number | null;
  quartos: number | null;
  suites: number | null;
  garagem: number | null;
  fotos: string[] | null;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

export function parseUpdate(update: Record<string, unknown>): ParsedUpdate {
  if (update.message) {
    const msg = update.message as Record<string, unknown>;
    const chatId = (msg.chat as Record<string, unknown>).id as number;
    if (msg.voice) {
      const voice = msg.voice as Record<string, unknown>;
      return { type: "voice", chatId, fileId: voice.file_id as string };
    }
    if (msg.text) {
      return { type: "text", chatId, text: msg.text as string };
    }
  }
  if (update.callback_query) {
    const cb = update.callback_query as Record<string, unknown>;
    const chatId = (cb.from as Record<string, unknown>).id as number;
    const data = cb.data as string;
    if (data.startsWith("page:")) {
      return { type: "page", chatId, page: parseInt(data.split(":")[1]), callbackId: cb.id as string };
    }
  }
  return { type: "unknown" };
}

// ── Formatação ────────────────────────────────────────────────────────────────

/** Formata número como moeda pt-BR sem depender de locale do runtime */
function formatPreco(value: number): string {
  return "R$ " + value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatCaption(imovel: Imovel): string {
  const preco = imovel.preco ? formatPreco(imovel.preco) : "Consulte";
  const detalhes = [
    imovel.quartos != null ? `🛏 ${imovel.quartos}q` : null,
    imovel.suites != null ? `🚿 ${imovel.suites}s` : null,
    imovel.garagem != null ? `🚗 ${imovel.garagem}` : null,
    imovel.area_m2 != null ? `📐 ${imovel.area_m2}m²` : null,
  ].filter(Boolean).join(" · ");

  return [
    `🏠 ${imovel.titulo}`,
    `📍 ${imovel.bairro ?? "—"} · ${imovel.tipo ?? "—"}`,
    detalhes,
    `💰 ${preco}`,
  ].filter(Boolean).join("\n");
}

// ── Telegram API ──────────────────────────────────────────────────────────────

async function telegramPost(token: string, method: string, body: unknown): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Telegram ${method} error:`, err);
  }
}

export async function sendText(token: string, chatId: number, text: string): Promise<void> {
  await telegramPost(token, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

export async function sendPhoto(
  token: string,
  chatId: number,
  imovel: Imovel,
  showMore: boolean,
  currentPage: number,
): Promise<void> {
  const photo = imovel.fotos?.[0] ?? null;
  const caption = formatCaption(imovel);
  const inline_keyboard = [
    [
      { text: "🔗 Ver anúncio", url: imovel.url },
      { text: "❤️ Salvar", callback_data: `save:${encodeURIComponent(imovel.url)}` },
    ],
  ];
  if (showMore) {
    inline_keyboard.push([{ text: "Ver mais →", callback_data: `page:${currentPage + 1}` }]);
  }
  if (photo) {
    await telegramPost(token, "sendPhoto", {
      chat_id: chatId,
      photo,
      caption,
      reply_markup: { inline_keyboard },
    });
  } else {
    await telegramPost(token, "sendMessage", {
      chat_id: chatId,
      text: caption + `\n\n<a href="${imovel.url}">Ver anúncio</a>`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard },
    });
  }
}

export async function answerCallbackQuery(token: string, callbackId: string): Promise<void> {
  await telegramPost(token, "answerCallbackQuery", { callback_query_id: callbackId });
}

export async function getFileUrl(token: string, fileId: string): Promise<string> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`);
  const data = await res.json() as { result: { file_path: string } };
  return `${TELEGRAM_API}/file/bot${token}/${data.result.file_path}`;
}
