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
  endereco?: string | null;
  preco: number | null;
  valor_condominio?: number | null;
  area_m2: number | null;
  quartos: number | null;
  suites: number | null;
  garagem: number | null;
  fotos: string[] | null;
  mobiliado?: boolean | null;
  detalhes_imovel?: {
    estado_imovel?: string | null;
    diferenciais?: string[] | null;
    acabamentos?: string[] | null;
    condominio?: string[] | null;
    localizacao_detalhes?: string[] | null;
    observacoes_extras?: string[] | null;
  } | null;
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
    const msg = cb.message as Record<string, unknown> | undefined;
    const chatId = msg
      ? ((msg.chat as Record<string, unknown>).id as number)
      : ((cb.from as Record<string, unknown>).id as number);
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

  // Endereço truncado
  let enderecoLine: string | null = null;
  if (imovel.endereco) {
    const end = imovel.endereco.length > 60
      ? imovel.endereco.slice(0, 59) + "…"
      : imovel.endereco;
    enderecoLine = `🗺 ${end}`;
  }

  // Preço + condomínio inline
  const condLabel = imovel.valor_condominio
    ? `  |  🏢 Cond. ${formatPreco(imovel.valor_condominio)}`
    : "";
  const precoLine = `💰 ${preco}${condLabel}`;

  // Estado + mobiliado
  const estadoEmoji: Record<string, string> = {
    "novo": "🆕",
    "reformado": "🔨",
    "bem conservado": "✔️",
    "precisa reforma": "🛠️",
  };
  const estado = imovel.detalhes_imovel?.estado_imovel;
  const estadoLabel = estado
    ? `${estadoEmoji[estado] ?? "🏷️"} ${estado.charAt(0).toUpperCase() + estado.slice(1)}`
    : null;
  const extras = [
    imovel.mobiliado === true ? "✅ Mobiliado" : null,
    estadoLabel,
  ].filter(Boolean).join("  ");

  // Dados enriquecidos
  const diferenciais = imovel.detalhes_imovel?.diferenciais?.join(" · ") ?? null;
  const acabamentos = imovel.detalhes_imovel?.acabamentos?.slice(0, 3).join(" · ") ?? null;
  const amenidades = imovel.detalhes_imovel?.condominio?.slice(0, 3).join(" · ") ?? null;
  const localizacao = imovel.detalhes_imovel?.localizacao_detalhes?.slice(0, 2).join(" · ") ?? null;
  const observacoes = imovel.detalhes_imovel?.observacoes_extras?.slice(0, 3).join(" · ") ?? null;

  const caption = [
    `🏠 ${imovel.titulo}`,
    `📍 ${imovel.bairro ?? "—"} · ${imovel.tipo ?? "—"}`,
    enderecoLine,
    detalhes || null,
    precoLine,
    extras || null,
    diferenciais ? `🌟 ${diferenciais}` : null,
    acabamentos ? `🪟 ${acabamentos}` : null,
    amenidades ? `🏊 ${amenidades}` : null,
    localizacao ? `📌 ${localizacao}` : null,
    observacoes ? `📝 ${observacoes}` : null,
  ].filter(Boolean).join("\n");

  // Fallback: truncar se exceder 1020 chars
  if (caption.length > 1020) {
    return caption.slice(0, 1020) + "…";
  }
  return caption;
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
    throw new Error(`Telegram ${method} falhou: ${err}`);
  }
}

export async function sendText(token: string, chatId: number, text: string): Promise<void> {
  await telegramPost(token, "sendMessage", { chat_id: chatId, text });
}

export async function sendPhoto(
  token: string,
  chatId: number,
  imovel: Imovel,
  showMore: boolean,
  currentPage: number,
): Promise<void> {
  // Ignorar placeholders genéricos (img_h.png) e usar primeira foto real
  const photo = imovel.fotos?.find((f) => !f.includes("img_h")) ?? null;
  const caption = formatCaption(imovel);
  const inline_keyboard = [
    [
      { text: "🔗 Ver anúncio", url: imovel.url },
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
      text: caption + `\n\n${imovel.url}`,
      reply_markup: { inline_keyboard },
    });
  }
}

export async function sendVoice(token: string, chatId: number, audioBytes: Uint8Array): Promise<void> {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("voice", new Blob([audioBytes], { type: "audio/mpeg" }), "voice.mp3");
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendVoice`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Telegram sendVoice error:", err);
    throw new Error(`Telegram sendVoice falhou: ${err}`);
  }
}

export async function answerCallbackQuery(token: string, callbackId: string): Promise<void> {
  await telegramPost(token, "answerCallbackQuery", { callback_query_id: callbackId });
}

export async function getFileUrl(token: string, fileId: string): Promise<string> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`);
  const data = await res.json() as { ok: boolean; result?: { file_path: string } };
  if (!data.ok || !data.result?.file_path) {
    throw new Error(`Telegram getFile falhou para file_id=${fileId}`);
  }
  return `${TELEGRAM_API}/file/bot${token}/${data.result.file_path}`;
}
