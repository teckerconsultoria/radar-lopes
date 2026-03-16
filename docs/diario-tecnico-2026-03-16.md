# Diário Técnico — Radar Lopes
**Data:** 16 de março de 2026
**Projeto:** radar-lopes — Bot Telegram de busca de imóveis (Lopes de Andrade)

---

## Resumo do dia

Sessão intensa de desenvolvimento em duas frentes principais: **enriquecimento qualitativo dos dados** do banco de imóveis e **evolução do bot Telegram** com suporte a áudio bidirecional (entrada via voz + resposta em voz). A sessão incluiu scraping completo do site, enriquecimento via Anthropic Batch API, múltiplos ciclos de debug e deploy em produção.

---

## 1. Enriquecimento Qualitativo dos Imóveis

### 1.1 Migration de banco (`supabase/migrations/003_imoveis_enrich.sql`)

Adicionadas duas novas colunas à tabela `imoveis`:

```sql
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS detalhes_imovel JSONB;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS mobiliado BOOLEAN;
```

`detalhes_imovel` armazena um objeto JSON com campos qualitativos extraídos da descrição livre do anúncio. `mobiliado` é um booleano direto para facilitar filtragem.

### 1.2 Script de enriquecimento (`scraper/enrich_imoveis.py`)

Script Python que utiliza a **Anthropic Batch API** (modelo `claude-haiku-4-5`) para processar em lote as descrições dos imóveis e extrair dados qualitativos estruturados.

**Schema extraído por imóvel:**
```json
{
  "mobiliado": true | false | null,
  "detalhes_imovel": {
    "estado_imovel": "novo | reformado | bem conservado | precisa reforma | null",
    "diferenciais": ["sol da manhã", "andar alto", "vista mar", ...],
    "acabamentos": ["piso porcelanato", "cozinha planejada", ...],
    "condominio": ["piscina", "academia", "portaria 24h", ...],
    "localizacao_detalhes": ["próximo ao shopping", "a 200m da praia", ...],
    "observacoes_extras": ["condomínio R$600/mês", "semi-mobiliado", ...]
  }
}
```

**Fluxo do script:**
1. Busca imóveis com `status='ativo'`, `descricao IS NOT NULL` e `detalhes_imovel IS NULL`
2. Monta um `MessageBatchRequestParam` por imóvel
3. Submete o batch e faz polling até completar (intervalo 15s)
4. Parseia as respostas e faz upsert no Supabase
5. Idempotente por padrão; flags `--force` (reprocessa todos) e `--test N` (subconjunto)

**Resultado da execução:**
- 118 imóveis processados
- 118/118 enriquecidos com sucesso
- Qualidade verificada via SQL (estado_imovel, diferenciais, mobiliados)

### 1.3 Ordem de execução e decisão estratégica

Optou-se por rodar o **scraper completo primeiro** (atualizar/inserir imóveis do site) e só então enriquecer — garantindo que o enriquecimento cobre o inventário mais atualizado. O scraper processou 118 imóveis (6 inseridos, 112 atualizados, 5 inativados) em ~3 minutos.

---

## 2. Evolução do Bot Telegram

### 2.1 Contexto expandido para follow-ups (`agent.ts` — PROMPT_VERSION v5)

O agente enviava ao Claude apenas `{titulo, bairro, preco}` por imóvel na amostra do tool_result. Isso impedia respostas a perguntas de follow-up sem nova busca.

**Amostra expandida de 3 campos para 14:**
```typescript
sample: imoveis.slice(0, 5).map((i) => ({
  titulo, bairro, preco, area_m2, quartos, suites,
  banheiros, garagem, andar, eh_terreo, mobiliado,
  caracteristicas, pois, detalhes_imovel
}))
```

Claude agora responde "todos têm suíte?", "qual o maior?", "é mobiliado?", "qual estado?" sem re-buscar.

### 2.2 Filtro `mobiliado` em `search.ts`

Adicionado `mobiliado?: boolean` em:
- Interface `ToolFilters`
- Interface `SupabaseFilters`
- Função `buildSupabaseFilters()`
- Query do Supabase: `query.eq("mobiliado", filters.mobiliado)`
- Definição `BUSCAR_IMOVEIS_TOOL` (propriedade para o Claude)

### 2.3 Correção: múltiplos `tool_use` blocks

**Problema descoberto em testes:** Quando o usuário perguntava "venda ou aluguel?", Claude emitia **dois** `tool_use` blocks simultâneos. A API Anthropic exige `tool_result` para **todos** os blocks ou retorna erro 400.

**Solução implementada:**
```typescript
const allToolUseBlocks = response.content
  .filter((b) => b.type === "tool_use");

const toolResults = allToolUseBlocks.map((block, idx) => ({
  type: "tool_result",
  tool_use_id: block.id,
  content: idx === 0
    ? JSON.stringify({ total, sample: [...] })
    : JSON.stringify({ total: 0, sample: [] }), // demais: vazio
}));
```

Adicionalmente: quando há múltiplos `tool_use` blocks, `autoSendCards` é definido como `false` (Claude explorando opções, não confirmando resultado).

### 2.4 Suporte a áudio de entrada (Whisper via Groq)

Já estava em produção. O webhook detecta `parsed.type === "voice"`, obtém a URL do arquivo do Telegram, transcreve via Groq Whisper (`whisper-large-v3-turbo`) e processa o texto transcrito normalmente.

### 2.5 Resposta em áudio: ElevenLabs → OpenAI TTS

**Primeira tentativa:** ElevenLabs (`eleven_multilingual_v2`). Retornou erro 401 com mensagem de "unusual activity detected / free tier disabled" (bloqueio por proxy do servidor Supabase).

**Solução:** Migração para **OpenAI TTS** (`tts-1`, voz `nova`). Custo ~$0.015/1k caracteres. Módulo `modules/tts.ts` criado:

```typescript
const res = await fetch("https://api.openai.com/v1/audio/speech", {
  body: JSON.stringify({
    model: "tts-1",
    input: text,
    voice,          // "nova" por padrão, configurável via TTS_VOICE
    response_format: "mp3",
  }),
});
```

### 2.6 Áudio rico + cards sob demanda (PROMPT_VERSION v6)

**Problema:** Resposta em áudio era muito curta ("Encontrei X imóveis.") — não aproveitava a natureza conversacional do canal de voz.

**Implementação:**

`agent.ts` — novo parâmetro `voiceMode: boolean`:
- Quando `voiceMode=true`: `autoSendCards = false` (cards não enviados automaticamente)
- Instrução injetada no `tool_result`:

```
[MODO ÁUDIO] Gere uma resposta de 3-5 frases faladas naturalmente:
(1) total encontrado com bairros e faixa de preço/área,
(2) destaque 1-2 características relevantes da amostra (mobiliado, estado, diferenciais),
(3) pergunte se o corretor quer visualizar os cards ou sugira um filtro adicional.
Não liste imóveis individualmente.
```

- `max_tokens` do followUp: `voiceMode ? 1024 : 512`

`index.ts` — passa `isVoice` para `processMessage`:
```typescript
const { texto, imoveis, total, autoSendCards } = await processMessage(
  chatId, userText, ANTHROPIC_KEY, SUPABASE_URL, SUPABASE_KEY, isVoice
);
```

**Fluxo em modo voz:**
1. Corretor envia áudio → transcrito → agente processa
2. Agente gera resumo rico + pergunta "quer ver os cards?"
3. Bot envia **áudio** de resposta (TTS)
4. Corretor responde "sim" → agente re-chama `buscar_imoveis` → cards enviados

**System prompt atualizado:**
> "Quando o corretor confirmar que quer ver os imóveis (ex: "sim", "quero ver", "mostra", "pode mandar"), chame buscar_imoveis com os mesmos filtros da busca anterior."

### 2.7 Cards com dados enriquecidos (`telegram.ts`)

Interface `Imovel` ampliada com campos opcionais:
```typescript
mobiliado?: boolean | null;
detalhes_imovel?: {
  estado_imovel?: string | null;
  diferenciais?: string[] | null;
} | null;
```

`formatCaption()` agora exibe linha extra quando há dados enriquecidos:
```
🏠 Título
📍 Bairro · Tipo
🛏 3q · 🚿 2s · 🚗 2 · 📐 95m²
💰 R$ 2.500
✅ Mobiliado  🔨 Reformado  andar alto · vista mar
```

Mapeamento de emojis por estado: `novo→🆕`, `reformado→🔨`, `bem conservado→✔️`, `precisa reforma→🛠️`.

---

## 3. Debugging e Incidentes

| Problema | Causa raiz | Solução |
|---|---|---|
| `ModuleNotFoundError: playwright` | `.venv` não ativado no terminal PowerShell | `source .venv/Scripts/activate` + usar `python` (não `py`) |
| Erro `parse_mode: HTML` no Telegram | Respostas do Claude contêm `&` e chars especiais | Removido `parse_mode: HTML` do `sendText` e fallback `sendMessage` |
| `tool_result` faltando para múltiplos blocks | Claude emitia 2 `tool_use` em perguntas ambíguas | Coletar todos os blocks e retornar `tool_result` para cada um |
| Cards enviados prematuramente | `autoSendCards` não retornado de `processMessage` | Adicionado `autoSendCards: false` quando múltiplos tool_use ou voiceMode |
| ElevenLabs 401 "unusual activity" | Free tier bloqueado por detecção de proxy | Migrado para OpenAI TTS |
| Resposta em áudio curta | System prompt instrui resposta de 1 frase | Instrução de modo áudio injetada no `tool_result` + `voiceMode` flag |

---

## 4. Variáveis de Ambiente (estado final)

| Variável | Descrição |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token do bot |
| `TELEGRAM_WEBHOOK_SECRET` | Secret do webhook |
| `ANTHROPIC_API_KEY` | Claude Sonnet 4.6 (agente) |
| `WHISPER_API_KEY` | Groq API key (transcrição) |
| `WHISPER_PROVIDER` | `groq` (padrão) |
| `OPENAI_API_KEY` | OpenAI (TTS) |
| `TTS_VOICE` | `nova` (padrão) — opções: alloy, echo, fable, onyx, nova, shimmer |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Anon key do Supabase |

---

## 5. Commits do dia

| Hash | Descrição |
|---|---|
| `c557b14` | feat(enriquecimento): migration + enrich_imoveis.py + filtro mobiliado + sample expandida |
| `b4588db` | feat(telegram-bot): resposta em áudio rica + dados enriquecidos nos cards |

---

## 6. Estado final do sistema

**Edge Function:** `telegram-webhook` v28 (Supabase, projeto `efwlpprsuygnhzksvibq`)
**PROMPT_VERSION:** `v6`
**Imóveis enriquecidos:** 118/118
**Branch:** `master` — sincronizado com `origin/master`

### Fluxo completo atual

```
Corretor (texto)  →  Webhook  →  Claude (busca)  →  texto + cards
Corretor (áudio)  →  Whisper  →  Claude (busca)  →  TTS (resumo rico)
                                                  →  aguarda "sim"
                                                  →  cards enviados
```

---

## 7. Disponibilidade Contínua — GitHub Actions Keep-Alive

### Problema

O plano Free do Supabase pausa automaticamente projetos sem atividade por 7 dias, derrubando banco e Edge Functions.

### Solução implementada

Workflow GitHub Actions (`.github/workflows/keep-alive.yml`) com cron a cada 5 dias que faz um `GET` inócuo na REST API do Supabase:

```yaml
on:
  schedule:
    - cron: "0 9 1,6,11,16,21,26 * *"  # dias 1,6,11,16,21,26 às 9h UTC
  workflow_dispatch:                     # disparo manual disponível
```

**Request de ping:**
```
GET /rest/v1/imoveis?select=id&limit=1
Headers: apikey + Authorization (anon key)
```

Resposta HTTP 200 confirma que banco e projeto estão ativos. O job falha (exit 1) se receber status ≥ 400, alertando via GitHub.

### Configuração

Secrets configurados via GitHub CLI (`gh secret set`):

| Secret | Valor |
|---|---|
| `SUPABASE_URL` | `https://efwlpprsuygnhzksvibq.supabase.co` |
| `SUPABASE_ANON_KEY` | anon key JWT do projeto |

### Validação

Disparo manual executado com sucesso: job `ping` concluído em **4s** com status ✓.

---

## 8. Commits finais do dia

| Hash | Descrição |
|---|---|
| `c557b14` | feat(enriquecimento): migration + enrich_imoveis.py + filtro mobiliado + sample expandida |
| `b4588db` | feat(telegram-bot): resposta em áudio rica + dados enriquecidos nos cards |
| `ef9a567` | docs: diário técnico 2026-03-16 |
| `57c0fd3` | ci: keep-alive cron para evitar pausa do Supabase Free |
