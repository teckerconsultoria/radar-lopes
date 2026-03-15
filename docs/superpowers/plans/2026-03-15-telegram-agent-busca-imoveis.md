# Agente Telegram — Busca de Imóveis Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar um bot Telegram que recebe mensagens de texto e áudio em linguagem natural, usa Claude para extrair filtros, busca imóveis no Supabase e retorna fotos com legenda e inline buttons.

**Architecture:** Supabase Edge Function (`telegram-webhook`) com quatro módulos internos (telegram, transcription, search, agent). Histórico de conversa persistido na tabela `conversations` por `chat_id`. Transcrição de áudio via Groq Whisper. Claude usa tool use (`buscar_imoveis`) para acionar a busca de forma estruturada.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, `@anthropic-ai/sdk` (npm), `@supabase/supabase-js` (esm.sh), Telegram Bot API (fetch direto), Groq Whisper API.

**Spec:** `docs/superpowers/specs/2026-03-15-telegram-agent-busca-imoveis-design.md`

---

## File Structure

```
supabase/
├── migrations/
│   └── 002_conversations.sql          CREATE — nova tabela conversations
└── functions/
    └── telegram-webhook/
        ├── index.ts                   CREATE — entry point, orquestra módulos
        ├── _tests/
        │   ├── telegram_test.ts       CREATE — testes unitários do módulo telegram
        │   ├── search_test.ts         CREATE — testes unitários do módulo search
        │   └── agent_test.ts          CREATE — testes unitários do módulo agent
        └── modules/
            ├── telegram.ts            CREATE — parse update, send photo/text, inline buttons
            ├── transcription.ts       CREATE — download OGG → Groq Whisper → texto
            ├── search.ts              CREATE — buscarImoveis() + definição do tool Claude
            └── agent.ts               CREATE — Claude tool use + histórico conversations
```

---

## Chunk 1: Migration + Módulo Telegram

### Task 1: Migration `002_conversations.sql`

**Files:**
- Create: `supabase/migrations/002_conversations.sql`

- [ ] **Step 1: Criar migration**

```sql
-- supabase/migrations/002_conversations.sql
CREATE TABLE conversations (
  id         BIGSERIAL PRIMARY KEY,
  chat_id    BIGINT NOT NULL,
  messages   JSONB  NOT NULL DEFAULT '[]',
  filters    JSONB  DEFAULT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX ON conversations(chat_id);
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Aplicar migration no projeto remoto**

> Este projeto usa Supabase remoto diretamente (sem instância Docker local). O comando abaixo envia a migration para o banco remoto já linkado.

```bash
cd C:/claudecode/workspace/radar-lopes
supabase db push
```

Expected: `Applied 1 migration` sem erros. Verificar no Supabase Dashboard → Table Editor → tabela `conversations` criada.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/002_conversations.sql
git commit -m "feat(db): adicionar tabela conversations para histórico do agente Telegram"
```

---

### Task 2: `modules/telegram.ts`

**Files:**
- Create: `supabase/functions/telegram-webhook/modules/telegram.ts`
- Create: `supabase/functions/telegram-webhook/_tests/telegram_test.ts`

- [ ] **Step 1: Escrever testes para `parseUpdate` e `formatCaption`**

```typescript
// supabase/functions/telegram-webhook/_tests/telegram_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseUpdate, formatCaption } from "../modules/telegram.ts";

Deno.test("parseUpdate - mensagem de texto", () => {
  const update = {
    update_id: 1,
    message: {
      message_id: 10,
      chat: { id: 123456789 },
      text: "quero apartamento em Manaíra",
    },
  };
  const result = parseUpdate(update);
  assertEquals(result.type, "text");
  assertEquals(result.chatId, 123456789);
  assertEquals(result.text, "quero apartamento em Manaíra");
});

Deno.test("parseUpdate - mensagem de voz", () => {
  const update = {
    update_id: 2,
    message: {
      message_id: 11,
      chat: { id: 123456789 },
      voice: { file_id: "abc123", duration: 5 },
    },
  };
  const result = parseUpdate(update);
  assertEquals(result.type, "voice");
  assertEquals(result.chatId, 123456789);
  assertEquals(result.fileId, "abc123");
});

Deno.test("parseUpdate - callback_query paginação", () => {
  const update = {
    update_id: 3,
    callback_query: {
      id: "cb1",
      from: { id: 123456789 },
      data: "page:2",
    },
  };
  const result = parseUpdate(update);
  assertEquals(result.type, "page");
  assertEquals(result.chatId, 123456789);
  assertEquals(result.page, 2);
});

Deno.test("formatCaption - imóvel completo", () => {
  const imovel = {
    titulo: "Apto 3 Quartos Manaíra",
    bairro: "Manaíra",
    tipo: "Apartamento",
    quartos: 3,
    suites: 1,
    garagem: 2,
    area_m2: 95,
    preco: 650000,
    url: "https://lopesdeandrade.com.br/imovel/123",
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🏠 Apto 3 Quartos Manaíra"), true);
  assertEquals(caption.includes("📍 Manaíra · Apartamento"), true);
  assertEquals(caption.includes("🛏 3q"), true);
  assertEquals(caption.includes("💰 R$ 650.000"), true);
});

Deno.test("formatCaption - preço nulo não quebra", () => {
  const imovel = {
    titulo: "Terreno Bessa",
    bairro: "Bessa",
    tipo: "Terreno",
    quartos: null,
    suites: null,
    garagem: null,
    area_m2: 300,
    preco: null,
    url: "https://lopesdeandrade.com.br/imovel/456",
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("💰 Consulte"), true);
});
```

- [ ] **Step 2: Rodar testes — confirmar que falham**

```bash
cd C:/claudecode/workspace/radar-lopes
deno test supabase/functions/telegram-webhook/_tests/telegram_test.ts
```

Expected: erro `Cannot resolve module` (módulo ainda não existe).

- [ ] **Step 3: Implementar `modules/telegram.ts`**

```typescript
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
```

- [ ] **Step 4: Rodar testes — confirmar que passam**

```bash
deno test supabase/functions/telegram-webhook/_tests/telegram_test.ts
```

Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/telegram-webhook/modules/telegram.ts \
        supabase/functions/telegram-webhook/_tests/telegram_test.ts
git commit -m "feat(telegram-bot): adicionar módulo telegram (parse + format + API helpers)"
```

---

## Chunk 2: Transcrição + Busca

### Task 3: `modules/transcription.ts`

**Files:**
- Create: `supabase/functions/telegram-webhook/modules/transcription.ts`

> Nota: `transcription.ts` realiza duas chamadas HTTP externas (Telegram + Groq). Os testes unitários são omitidos aqui pois requerem mocks de rede — a verificação será feita manualmente no Task 7 (end-to-end). O módulo é simples o suficiente que testes de integração manual são suficientes para a fase de validação.

- [ ] **Step 1: Implementar `modules/transcription.ts`**

```typescript
// supabase/functions/telegram-webhook/modules/transcription.ts

const GROQ_API = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_API = "https://api.openai.com/v1/audio/transcriptions";

export async function transcribeVoice(
  audioUrl: string,
  apiKey: string,
  provider: "groq" | "openai" = "groq",
): Promise<string> {
  // Baixar arquivo OGG do Telegram
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Falha ao baixar áudio: ${audioRes.status}`);
  const audioBlob = await audioRes.blob();

  // Montar form data para Whisper
  const formData = new FormData();
  formData.append("file", new File([audioBlob], "audio.ogg", { type: "audio/ogg" }));
  formData.append("model", provider === "groq" ? "whisper-large-v3-turbo" : "whisper-1");
  formData.append("language", "pt");
  formData.append("response_format", "text");

  const endpoint = provider === "groq" ? GROQ_API : OPENAI_API;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error (${provider}): ${err}`);
  }

  return (await res.text()).trim();
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/telegram-webhook/modules/transcription.ts
git commit -m "feat(telegram-bot): adicionar módulo de transcrição de áudio (Groq Whisper)"
```

---

### Task 4: `modules/search.ts`

**Files:**
- Create: `supabase/functions/telegram-webhook/modules/search.ts`
- Create: `supabase/functions/telegram-webhook/_tests/search_test.ts`

- [ ] **Step 1: Escrever testes para `buildFilters` e `toolDefinition`**

```typescript
// supabase/functions/telegram-webhook/_tests/search_test.ts
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSupabaseFilters, BUSCAR_IMOVEIS_TOOL } from "../modules/search.ts";

Deno.test("buildSupabaseFilters - converte snake_case para campos Supabase", () => {
  const toolInput = {
    tipos: ["Apartamento", "Casa"],
    bairros: ["Manaíra"],
    quartos_min: 3,
    preco_max: 800000,
    caracteristicas: ["piscina"],
  };
  const filters = buildSupabaseFilters(toolInput);
  assertEquals(filters.tipos, ["Apartamento", "Casa"]);
  assertEquals(filters.bairros, ["Manaíra"]);
  assertEquals(filters.quartosMin, 3);
  assertEquals(filters.precoMax, 800000);
  assertEquals(filters.caracteristicas, ["piscina"]);
});

Deno.test("buildSupabaseFilters - campos booleanos opcionais", () => {
  const filters = buildSupabaseFilters({ eh_terreo: true, aceita_financiamento: true });
  assertEquals(filters.ehTerreo, true);
  assertEquals(filters.aceitaFinanciamento, true);
});

Deno.test("buildSupabaseFilters - campos ausentes ficam undefined", () => {
  const filters = buildSupabaseFilters({});
  assertEquals(filters.quartosMin, undefined);
  assertEquals(filters.precoMin, undefined);
});

Deno.test("BUSCAR_IMOVEIS_TOOL - tem name e input_schema", () => {
  assertExists(BUSCAR_IMOVEIS_TOOL.name);
  assertExists(BUSCAR_IMOVEIS_TOOL.input_schema);
  assertEquals(BUSCAR_IMOVEIS_TOOL.name, "buscar_imoveis");
});
```

- [ ] **Step 2: Rodar testes — confirmar que falham**

```bash
deno test supabase/functions/telegram-webhook/_tests/search_test.ts
```

Expected: erro `Cannot resolve module`.

- [ ] **Step 3: Implementar `modules/search.ts`**

```typescript
// supabase/functions/telegram-webhook/modules/search.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ToolFilters {
  tipos?: string[];
  bairros?: string[];
  quartos_min?: number;
  quartos_max?: number;
  suites_min?: number;
  garagem_min?: number;
  preco_min?: number;
  preco_max?: number;
  area_min?: number;
  area_max?: number;
  eh_terreo?: boolean;
  aceita_financiamento?: boolean;
  novo?: boolean;
  reformado?: boolean;
  caracteristicas?: string[];
  texto?: string;
  sort_by?: "recente" | "preco_asc" | "preco_desc" | "area_asc" | "area_desc";
}

export interface SupabaseFilters {
  tipos?: string[];
  bairros?: string[];
  quartosMin?: number;
  quartosMax?: number;
  suitesMin?: number;
  garagemMin?: number;
  precoMin?: number;
  precoMax?: number;
  areaMin?: number;
  areaMax?: number;
  ehTerreo?: boolean;
  aceitaFinanciamento?: boolean;
  novo?: boolean;
  reformado?: boolean;
  caracteristicas?: string[];
  texto?: string;
  sortBy?: string;
}

// ── Mapeamento snake_case → camelCase ─────────────────────────────────────────

export function buildSupabaseFilters(toolInput: ToolFilters): SupabaseFilters {
  return {
    tipos:               toolInput.tipos,
    bairros:             toolInput.bairros,
    quartosMin:          toolInput.quartos_min,
    quartosMax:          toolInput.quartos_max,
    suitesMin:           toolInput.suites_min,
    garagemMin:          toolInput.garagem_min,
    precoMin:            toolInput.preco_min,
    precoMax:            toolInput.preco_max,
    areaMin:             toolInput.area_min,
    areaMax:             toolInput.area_max,
    ehTerreo:            toolInput.eh_terreo,
    aceitaFinanciamento: toolInput.aceita_financiamento,
    novo:                toolInput.novo,
    reformado:           toolInput.reformado,
    caracteristicas:     toolInput.caracteristicas,
    texto:               toolInput.texto,
    sortBy:              toolInput.sort_by,
  };
}

// ── Busca ─────────────────────────────────────────────────────────────────────

export async function buscarImoveis(
  filters: SupabaseFilters,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ data: Record<string, unknown>[]; count: number }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  let query = supabase
    .from("imoveis")
    .select("*", { count: "exact" })
    .eq("status", "ativo");

  if (filters.texto?.trim()) {
    query = query.textSearch("fts", filters.texto.trim(), { config: "portuguese", type: "websearch" });
  }
  if (filters.tipos?.length)         query = query.in("tipo", filters.tipos);
  if (filters.bairros?.length)       query = query.in("bairro", filters.bairros);
  if (filters.quartosMin != null)    query = query.gte("quartos", filters.quartosMin);
  if (filters.quartosMax != null)    query = query.lte("quartos", filters.quartosMax);
  if (filters.suitesMin != null)     query = query.gte("suites", filters.suitesMin);
  if (filters.garagemMin != null)    query = query.gte("garagem", filters.garagemMin);
  if (filters.precoMin != null)      query = query.gte("preco", filters.precoMin);
  if (filters.precoMax != null)      query = query.lte("preco", filters.precoMax);
  if (filters.areaMin != null)       query = query.gte("area_m2", filters.areaMin);
  if (filters.areaMax != null)       query = query.lte("area_m2", filters.areaMax);
  if (filters.ehTerreo)              query = query.eq("eh_terreo", true);
  if (filters.aceitaFinanciamento)   query = query.eq("aceita_financiamento", true);
  if (filters.novo)                  query = query.eq("novo", true);
  if (filters.reformado)             query = query.eq("reformado", true);
  if (filters.caracteristicas?.length) query = query.overlaps("caracteristicas", filters.caracteristicas);

  switch (filters.sortBy) {
    case "preco_asc":  query = query.order("preco",          { ascending: true,  nullsFirst: false }); break;
    case "preco_desc": query = query.order("preco",          { ascending: false, nullsFirst: false }); break;
    case "area_asc":   query = query.order("area_m2",        { ascending: true,  nullsFirst: false }); break;
    case "area_desc":  query = query.order("area_m2",        { ascending: false, nullsFirst: false }); break;
    default:           query = query.order("ultima_modificacao", { ascending: false, nullsFirst: false });
  }

  query = query.limit(50);
  const { data, count, error } = await query;
  if (error) throw new Error(`Supabase error: ${error.message}`);
  return { data: data ?? [], count: count ?? 0 };
}

// ── Tool definition para Claude ───────────────────────────────────────────────

export const BUSCAR_IMOVEIS_TOOL = {
  name: "buscar_imoveis",
  description: "Busca imóveis no banco de dados com filtros extraídos da conversa. Use sempre que o usuário indicar critérios de busca.",
  input_schema: {
    type: "object",
    properties: {
      tipos:                { type: "array", items: { type: "string" }, description: "Ex: ['Apartamento','Casa']" },
      bairros:              { type: "array", items: { type: "string" }, description: "Bairros de João Pessoa" },
      quartos_min:          { type: "integer" },
      quartos_max:          { type: "integer" },
      suites_min:           { type: "integer" },
      garagem_min:          { type: "integer" },
      preco_min:            { type: "number", description: "Preço mínimo em R$" },
      preco_max:            { type: "number", description: "Preço máximo em R$" },
      area_min:             { type: "number", description: "Área mínima em m²" },
      area_max:             { type: "number", description: "Área máxima em m²" },
      eh_terreo:            { type: "boolean" },
      aceita_financiamento: { type: "boolean" },
      novo:                 { type: "boolean" },
      reformado:            { type: "boolean" },
      caracteristicas:      { type: "array", items: { type: "string" }, description: "Ex: ['piscina','academia']" },
      texto:                { type: "string", description: "Busca em texto livre" },
      sort_by:              { type: "string", enum: ["recente","preco_asc","preco_desc","area_asc","area_desc"] },
    },
  },
};
```

- [ ] **Step 4: Rodar testes — confirmar que passam**

```bash
deno test supabase/functions/telegram-webhook/_tests/search_test.ts
```

Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/telegram-webhook/modules/search.ts \
        supabase/functions/telegram-webhook/_tests/search_test.ts
git commit -m "feat(telegram-bot): adicionar módulo de busca com mapeamento de filtros e tool definition"
```

---

## Chunk 3: Agente + Entry Point

### Task 5: `modules/agent.ts`

**Files:**
- Create: `supabase/functions/telegram-webhook/modules/agent.ts`
- Create: `supabase/functions/telegram-webhook/_tests/agent_test.ts`

- [ ] **Step 1: Escrever testes para `trimHistory` e `extractToolInput`**

```typescript
// supabase/functions/telegram-webhook/_tests/agent_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { trimHistory, extractToolInput } from "../modules/agent.ts";

Deno.test("trimHistory - mantém últimas 20 mensagens", () => {
  const messages = Array.from({ length: 25 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg ${i}`,
  }));
  const trimmed = trimHistory(messages);
  assertEquals(trimmed.length, 20);
  assertEquals((trimmed[0] as { content: string }).content, "msg 5");
});

Deno.test("trimHistory - mantém histórico curto intacto", () => {
  const messages = [
    { role: "user", content: "olá" },
    { role: "assistant", content: "oi" },
  ];
  const trimmed = trimHistory(messages);
  assertEquals(trimmed.length, 2);
});

Deno.test("extractToolInput - extrai input do tool use block", () => {
  const content = [
    {
      type: "tool_use",
      id: "tu_1",
      name: "buscar_imoveis",
      input: { tipos: ["Apartamento"], quartos_min: 3 },
    },
  ];
  const result = extractToolInput(content);
  assertEquals(result?.tipos, ["Apartamento"]);
  assertEquals(result?.quartos_min, 3);
});

Deno.test("extractToolInput - retorna null se sem tool use", () => {
  const content = [{ type: "text", text: "Qual bairro você prefere?" }];
  const result = extractToolInput(content);
  assertEquals(result, null);
});
```

- [ ] **Step 2: Rodar testes — confirmar que falham**

```bash
deno test supabase/functions/telegram-webhook/_tests/agent_test.ts
```

Expected: erro `Cannot resolve module`.

- [ ] **Step 3: Implementar `modules/agent.ts`**

```typescript
// supabase/functions/telegram-webhook/modules/agent.ts
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BUSCAR_IMOVEIS_TOOL, buscarImoveis, buildSupabaseFilters, type ToolFilters } from "./search.ts";

const SYSTEM_PROMPT = `Você é o assistente de busca de imóveis da Lopes de Andrade Imóveis, especializado no mercado imobiliário de João Pessoa-PB.

Bairros disponíveis: Manaíra, Cabo Branco, Tambaú, Bessa, Altiplano, Miramar, Bancários, Água Fria, Jardim Oceania, Torre, Expedicionários, entre outros.
Tipos disponíveis: Apartamento, Casa, Terreno, Cobertura, Studio, Sala Comercial.
Características buscáveis: piscina, academia, churrasqueira, playground, portaria 24h, salão de festas, pet-friendly, varanda gourmet.

Comportamento:
- Aceite mensagens livres e extraia filtros implícitos. Use a ferramenta buscar_imoveis sempre que houver critérios suficientes.
- Só pergunte antes de buscar se a mensagem for muito genérica (ex: "quero um imóvel" sem nenhum critério).
- Após busca com muitos resultados (>8) ou nenhum resultado, sugira 1-2 perguntas de refinamento.
- Responda em português brasileiro, tom amigável e profissional.
- Antes de enviar os imóveis, informe quantos foram encontrados.`;

// ── Helpers exportados (testáveis sem Supabase/Anthropic) ─────────────────────

export function trimHistory(messages: unknown[]): unknown[] {
  return messages.slice(-20);
}

export function extractToolInput(
  content: Array<{ type: string; input?: unknown }>,
): ToolFilters | null {
  const block = content.find((b) => b.type === "tool_use");
  return block ? (block.input as ToolFilters) : null;
}

// ── Função principal ──────────────────────────────────────────────────────────

export async function processMessage(
  chatId: number,
  userText: string,
  anthropicKey: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ texto: string; imoveis: Record<string, unknown>[]; total: number; filters: ToolFilters | null }> {
  const supabase = createClient(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // Carregar histórico
  const { data: conv } = await supabase
    .from("conversations")
    .select("messages, filters")
    .eq("chat_id", chatId)
    .maybeSingle();

  const history: unknown[] = trimHistory((conv?.messages as unknown[]) ?? []);
  const lastFilters: ToolFilters | null = conv?.filters ?? null;

  // Adicionar mensagem do usuário
  const messages = [...history, { role: "user", content: userText }];

  // Primeira chamada ao Claude
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [BUSCAR_IMOVEIS_TOOL],
    messages: messages as Anthropic.MessageParam[],
  });

  let finalText = "";
  let imoveis: Record<string, unknown>[] = [];
  let total = 0;
  let activeFilters: ToolFilters | null = lastFilters;

  if (response.stop_reason === "tool_use") {
    // Claude quer buscar imóveis
    const toolInput = extractToolInput(
      response.content as Array<{ type: string; input?: unknown }>
    );

    if (toolInput) {
      activeFilters = toolInput;
      const supabaseFilters = buildSupabaseFilters(toolInput);
      const result = await buscarImoveis(supabaseFilters, supabaseUrl, supabaseKey);
      imoveis = result.data;
      total = result.count;

      // Segunda chamada com resultado do tool
      const followUp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        tools: [BUSCAR_IMOVEIS_TOOL],
        messages: [
          ...messages,
          { role: "assistant", content: response.content },
          {
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: (response.content.find((b: { type: string }) => b.type === "tool_use") as { id: string }).id,
              content: JSON.stringify({ total, sample: imoveis.slice(0, 3).map((i) => ({ titulo: i.titulo, bairro: i.bairro, preco: i.preco })) }),
            }],
          },
        ] as Anthropic.MessageParam[],
      });

      finalText = (followUp.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "";
    }
  } else {
    // Claude respondeu diretamente (pergunta de refinamento)
    finalText = (response.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "";
  }

  // Salvar histórico atualizado (sliding window 20)
  const updatedMessages = trimHistory([
    ...messages,
    { role: "assistant", content: finalText || response.content },
  ]);

  await supabase.from("conversations").upsert(
    { chat_id: chatId, messages: updatedMessages, filters: activeFilters, updated_at: new Date().toISOString() },
    { onConflict: "chat_id" },
  );

  return { texto: finalText, imoveis, total, filters: activeFilters };
}
```

- [ ] **Step 4: Rodar testes — confirmar que passam**

```bash
deno test supabase/functions/telegram-webhook/_tests/agent_test.ts
```

Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/telegram-webhook/modules/agent.ts \
        supabase/functions/telegram-webhook/_tests/agent_test.ts
git commit -m "feat(telegram-bot): adicionar módulo agent (Claude tool use + histórico conversations)"
```

---

### Task 6: `index.ts` — Entry Point

**Files:**
- Create: `supabase/functions/telegram-webhook/index.ts`

- [ ] **Step 1: Implementar `index.ts`**

```typescript
// supabase/functions/telegram-webhook/index.ts
import { parseUpdate, sendText, sendPhoto, answerCallbackQuery, getFileUrl } from "./modules/telegram.ts";
import { transcribeVoice } from "./modules/transcription.ts";
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
    let userText = "";
    if (parsed.type === "voice") {
      const fileUrl = await getFileUrl(TOKEN, parsed.fileId);
      userText = await transcribeVoice(fileUrl, WHISPER_KEY, WHISPER_PROVIDER);
      await sendText(TOKEN, chatId, `🎙️ _"${userText}"_`);
    } else {
      userText = parsed.text;
    }

    // ── Processar com agente ─────────────────────────────────────────────────
    const { texto, imoveis, total } = await processMessage(
      chatId, userText, ANTHROPIC_KEY, SUPABASE_URL, SUPABASE_KEY
    );

    if (texto) await sendText(TOKEN, chatId, texto);

    if (imoveis.length > 0) {
      const slice = imoveis.slice(0, PAGE_SIZE);
      const hasMore = total > PAGE_SIZE;
      for (let i = 0; i < slice.length; i++) {
        await sendPhoto(TOKEN, chatId, slice[i] as Parameters<typeof sendPhoto>[2], hasMore && i === slice.length - 1, 0);
      }
    }
  } catch (err) {
    console.error("Erro no webhook:", err);
    await sendText(TOKEN, chatId, "Desculpe, ocorreu um erro. Tente novamente em instantes.");
  }

  return new Response("OK");
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/telegram-webhook/index.ts
git commit -m "feat(telegram-bot): adicionar entry point index.ts com orquestração completa"
```

---

## Chunk 4: Deploy e Verificação

### Task 7: Deploy + Registro do Webhook

**Pré-requisitos:** Supabase CLI instalado, projeto linkado (`supabase link`), bot Telegram criado via @BotFather.

- [ ] **Step 1: Aplicar migration no projeto remoto**

```bash
supabase db push
```

Expected: `Applied 1 migration` sem erros. Verificar tabela `conversations` no Supabase Dashboard → Table Editor.

- [ ] **Step 2: Configurar secrets no Supabase**

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="<token do BotFather>" \
  TELEGRAM_WEBHOOK_SECRET="<string aleatória, ex: openssl rand -hex 16>" \
  ANTHROPIC_API_KEY="<chave Anthropic>" \
  WHISPER_API_KEY="<chave Groq>" \
  WHISPER_PROVIDER="groq"
```

- [ ] **Step 3: Deploy da Edge Function**

```bash
supabase functions deploy telegram-webhook --no-verify-jwt
```

Expected: `Deployed Function telegram-webhook`. Anotar a URL: `https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook`

- [ ] **Step 4: Registrar webhook no Telegram**

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","callback_query"]'
```

Expected: `{"ok":true,"result":true,"description":"Webhook was set"}`

- [ ] **Step 5: Verificar webhook registrado**

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Expected: `"url"` preenchida, `"pending_update_count": 0`, sem erros.

- [ ] **Step 6: Teste 1 — texto livre**

No Telegram, enviar para o bot: `quero apartamento 3 quartos em Manaíra`

Expected: resposta de texto do agente + até 5 fotos com legenda e botões `[🔗 Ver anúncio]` e `[❤️ Salvar]`.

- [ ] **Step 7: Teste 2 — mensagem vaga (pergunta proativa)**

Enviar: `quero comprar um imóvel`

Expected: o agente faz pelo menos uma pergunta de refinamento (tipo, bairro ou faixa de preço) **sem** enviar fotos.

- [ ] **Step 8: Teste 3 — refinamento incremental**

Após o teste anterior, responder: `apartamento, Cabo Branco, até 500 mil`

Expected: o agente busca e retorna fotos com os novos filtros aplicados.

- [ ] **Step 9: Teste 4 — áudio**

Enviar mensagem de voz descrevendo o imóvel desejado.

Expected: bot responde com eco da transcrição (`🎙️ "..."`) e em seguida retorna os resultados.

- [ ] **Step 10: Teste 5 — paginação**

Se a busca retornar > 5 imóveis, o último card deve ter botão `[Ver mais →]`. Clicar.

Expected: próximos 5 imóveis enviados.

- [ ] **Step 11: Commit final**

```bash
git add -A
git commit -m "feat(telegram-bot): agente Telegram de busca de imóveis — validação completa"
```
