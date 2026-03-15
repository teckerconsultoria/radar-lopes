# Design: Agente Telegram de Busca de Imóveis — Radar Lopes

**Data:** 2026-03-15
**Status:** Aprovado

---

## Contexto e Motivação

O Radar Lopes possui um FilterPanel com filtros estruturados (tipo, bairro, quartos, preço, área, características). O objetivo é criar um agente conversacional no Telegram que permite busca por linguagem natural e áudio, validando a lógica do agente antes de integrá-la à PWA.

O agente roda como Supabase Edge Function, mantém histórico de conversa por `chat_id` e usa Claude (tool use) + Whisper (transcrição de áudio) para entender o usuário e retornar fotos dos imóveis com inline buttons.

---

## Decisões de Design

| Decisão | Escolha | Motivo |
|---|---|---|
| Plataforma de validação | Telegram | Mais simples que PWA; valida lógica sem frontend |
| Backend | Supabase Edge Function (TypeScript/Deno) | Mesma infraestrutura existente; chave Anthropic segura |
| Modo de busca | Híbrido (free-form + refinamento) | Flexível; não força wizard, mas guia quando necessário |
| Apresentação | Foto + legenda + inline buttons | Rica visualmente; navegação fluida |
| Histórico | Persistido no Supabase (`conversations`) | Reutilizável pelo módulo de follow-up futuro |
| Transcrição | Groq Whisper (`whisper-large-v3-turbo`) | Rápido, barato; alternativa: OpenAI `whisper-1` |
| Estrutura interna | Módulos separados dentro de uma função | Simples para validação; fácil migrar para Queue depois |

---

## Arquitetura

```
Telegram User
     │ POST update (texto / áudio / callback_query)
     ▼
supabase/functions/telegram-webhook/index.ts
     ├── modules/telegram.ts       ← parse update, send photo, inline buttons
     ├── modules/transcription.ts  ← download voice → Whisper → texto
     ├── modules/agent.ts          ← Claude API + histórico + tool use
     └── modules/search.ts         ← query tabela imoveis
     │
     ├── Supabase: tabela conversations  ← histórico por chat_id
     └── Supabase: tabela imoveis        ← base existente
```

---

## Modelo de Dados

### Tabela existente: `imoveis`
Campos usados pelo agente: `url`, `titulo`, `tipo`, `bairro`, `preco`, `area_m2`, `quartos`, `suites`, `banheiros`, `garagem`, `andar`, `eh_terreo`, `eh_cobertura`, `aceita_financiamento`, `novo`, `reformado`, `caracteristicas[]`, `pois[]`, `descricao`, `fotos[]`, `fts`.

### Nova tabela: `conversations`
```sql
CREATE TABLE conversations (
  id         BIGSERIAL PRIMARY KEY,
  chat_id    BIGINT NOT NULL,
  messages   JSONB  NOT NULL DEFAULT '[]',
  filters    JSONB  DEFAULT NULL,   -- último conjunto de filtros ativos (para paginação)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX ON conversations(chat_id);
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
```

`messages` armazena array OpenAI-format (`role: user | assistant | tool`), limitado às **últimas 20 mensagens** (sliding window aplicado em `agent.ts` antes de enviar para Claude). Uma linha por usuário Telegram. Coluna `filters` armazena o último filtro ativo — usada para paginação sem reprocessar Claude.

---

## Estrutura de Arquivos

```
supabase/
├── migrations/
│   ├── 001_initial_schema.sql       (existente)
│   └── 002_conversations.sql        (novo)
└── functions/
    └── telegram-webhook/
        ├── index.ts                 (entry point)
        └── modules/
            ├── telegram.ts
            ├── transcription.ts
            ├── agent.ts
            └── search.ts
```

---

## Módulos

### `modules/telegram.ts`
- Parse do `Update` (texto, voz, `callback_query`)
- Funções: `sendText`, `sendPhoto`, `downloadVoiceFile`, `answerCallbackQuery`
- Legenda de cada imóvel:
  ```
  🏠 {titulo}
  📍 {bairro} · {tipo}
  🛏 {quartos}q · 🚿 {suites}s · 🚗 {garagem} vagas · 📐 {area_m2}m²
  💰 R$ {preco formatado}
  ```
- Inline buttons por imóvel: `[🔗 Ver anúncio]` (URL) + `[❤️ Salvar]` (callback, follow-up futuro)
- Paginação: 5 imóveis por vez. Se `total > (página+1)*5`, adicionar botão `[Ver mais →]` com `callback_data: "page:{página+1}"` (sem filtros no callback — filtros são recuperados de `conversations.filters` usando o `chat_id`)
- Em erros internos, enviar: `"Desculpe, ocorreu um erro. Tente novamente em instantes."`

**Nota de segurança:** validar header `X-Telegram-Bot-Api-Secret-Token` contra `TELEGRAM_WEBHOOK_SECRET`. Registrar webhook com `secret_token` correspondente e `allowed_updates=["message","callback_query"]`. Retornar HTTP 403 se token inválido.

### `modules/transcription.ts`
- Download do OGG via Telegram `getFile` + URL `https://api.telegram.org/file/bot{TOKEN}/{file_path}`
- POST multipart para Groq: `filename: "audio.ogg"`, `Content-Type: audio/ogg` (Groq identifica formato pelo nome do arquivo)
- Endpoint Groq: `https://api.openai.com/v1/audio/transcriptions` com base URL `https://api.groq.com/openai/v1`
- Modelo: `whisper-large-v3-turbo`, `language: "pt"`
- Env vars: `WHISPER_API_KEY`, `WHISPER_PROVIDER` (`groq` | `openai`, default `groq`)

### `modules/search.ts`
- `buscarImoveis(filters, page?)` — lógica equivalente a `web/src/lib/queries.js`, reescrita para Deno
- Retorna até **50 resultados** (fatiados em memória a 5 por página pelo `index.ts`)
- Ordenação padrão: `ultima_modificacao DESC`; suporta `sortBy: "preco_asc" | "preco_desc" | "recente"`

**Mapeamento de campos:** o tool usa snake_case; `search.ts` faz a tradução para os nomes do store:

| Tool (snake_case) | queries.js (camelCase) | Coluna Supabase |
|---|---|---|
| `tipos` | `tipos` | `tipo` |
| `bairros` | `bairros` | `bairro` |
| `quartos_min` | `quartosMin` | `quartos >= N` |
| `quartos_max` | `quartosMax` | `quartos <= N` |
| `suites_min` | `suitesMin` | `suites >= N` |
| `garagem_min` | `garagemMin` | `garagem >= N` |
| `preco_min` | `precoMin` | `preco >= N` |
| `preco_max` | `precoMax` | `preco <= N` |
| `area_min` | `areaMin` | `area_m2 >= N` |
| `area_max` | `areaMax` | `area_m2 <= N` |
| `eh_terreo` | `ehTerreo` | `eh_terreo = true` |
| `aceita_financiamento` | — | `aceita_financiamento = true` |
| `novo` | — | `novo = true` |
| `reformado` | — | `reformado = true` |
| `caracteristicas` | `caracteristicas` | `overlaps` |
| `texto` | `texto` | FTS `websearch` |
| `sort_by` | `sortBy` | ORDER BY |

**Definição do tool `buscar_imoveis`:**
```typescript
{
  name: "buscar_imoveis",
  description: "Busca imóveis no banco de dados com filtros extraídos da conversa",
  input_schema: {
    type: "object",
    properties: {
      tipos:                { type: "array", items: { type: "string" } },
      bairros:              { type: "array", items: { type: "string" } },
      quartos_min:          { type: "integer" },
      quartos_max:          { type: "integer" },
      suites_min:           { type: "integer" },
      garagem_min:          { type: "integer" },
      preco_min:            { type: "number" },
      preco_max:            { type: "number" },
      area_min:             { type: "number" },
      area_max:             { type: "number" },
      eh_terreo:            { type: "boolean" },
      aceita_financiamento: { type: "boolean" },
      novo:                 { type: "boolean" },
      reformado:            { type: "boolean" },
      caracteristicas:      { type: "array", items: { type: "string" } },
      texto:                { type: "string" },
      sort_by:              { type: "string", enum: ["recente","preco_asc","preco_desc","area_asc","area_desc"] }
    }
  }
}
```

### `modules/agent.ts`
- Carrega histórico do `chat_id` de `conversations`
- Aplica sliding window: mantém apenas as **últimas 20 mensagens** antes de enviar para Claude
- Chama `anthropic.messages.create` com tool use ativado (model: `claude-sonnet-4-6`)
- Se Claude acionar `buscar_imoveis` → executa search → devolve resultado → resposta final
- Upsert do histórico atualizado + `filters` (último filtro) em `conversations`
- Retorna `{ texto: string, imoveis: Imovel[], total: number, filters: object }`

**System prompt:**
```
Você é o assistente de busca de imóveis da Lopes de Andrade Imóveis, especializado
no mercado imobiliário de João Pessoa-PB.

Bairros: Manaíra, Cabo Branco, Tambaú, Bessa, Altiplano, Miramar, Bancários,
Água Fria, Jardim Oceania, Torre, Expedicionários, entre outros.
Tipos: Apartamento, Casa, Terreno, Cobertura, Studio, Sala Comercial.
Características buscáveis: piscina, academia, churrasqueira, playground,
portaria 24h, salão de festas, pet-friendly, varanda gourmet.

Comportamento:
- Aceite mensagens livres e extraia filtros implícitos
- Só pergunte antes de buscar se a mensagem for muito genérica (ex: "quero um imóvel")
- Após busca com muitos resultados (>8) ou nenhum, sugira 1-2 refinamentos
- Responda em português brasileiro, tom amigável e profissional
- Informe quantos imóveis foram encontrados antes de enviá-los
```

### `index.ts`
Orquestra os módulos:
1. Validar `X-Telegram-Bot-Api-Secret-Token` → HTTP 403 se inválido
2. Parse do update → identificar tipo (texto / voz / `callback_query`)
3. Voz → `transcription.ts` → texto
4. `callback_query "page:{n}"` → recuperar `filters` de `conversations` → `search(filters, página n)` → `sendPhoto×5` sem Claude
5. Texto → `agent.ts` → `{ texto, imoveis, total, filters }`
6. `sendText(texto)` + `sendPhoto×5` com paginação se `total > 5`
7. Retornar HTTP 200 sempre; em exceção não tratada → `sendText` de erro ao usuário

---

## Fluxo de Ponta a Ponta

```
POST /telegram-webhook
         │
         ├─ header inválido? → HTTP 403
         ├─ voz?  → transcription → texto
         ├─ callback "page:{n}"? → conversations.filters + search(n) → sendPhoto×5
         └─ texto
                   │
                   ▼
              agent: histórico (sliding window 20) + Claude
                   │
                   ├─ pergunta de refinamento → sendText
                   └─ tool call: buscar_imoveis(filtros)
                             │
                             ▼
                        search → Supabase → imoveis[] (até 50)
                             │
                             ▼
                        Claude → resposta final
                             │
                             ▼
                        sendText(resumo) + sendPhoto×5 + buttons
                        upsert conversations (histórico + filters)
                             │
                             ▼
                        HTTP 200
```

---

## Deploy e Variáveis de Ambiente

**Secrets** (`supabase secrets set`):
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` — string aleatória; usada em `setWebhook secret_token` e validada em cada request
- `ANTHROPIC_API_KEY`
- `WHISPER_API_KEY`
- `WHISPER_PROVIDER` (default: `groq`)

> **Nota:** `SUPABASE_URL` e `SUPABASE_ANON_KEY` são injetadas automaticamente pelo runtime de Edge Functions. RLS está desabilitado em todas as tabelas (padrão do projeto), portanto a anon key é suficiente para ler `imoveis` e fazer upsert em `conversations`.

**Deploy:**
```bash
# Deploy da função
supabase functions deploy telegram-webhook

# Configurar secrets
supabase secrets set \
  TELEGRAM_BOT_TOKEN=xxx \
  TELEGRAM_WEBHOOK_SECRET=xxx \
  ANTHROPIC_API_KEY=xxx \
  WHISPER_API_KEY=xxx

# Registrar webhook com secret e filtro de update types
curl "https://api.telegram.org/bot{TOKEN}/setWebhook" \
  -d "url=https://{PROJECT_REF}.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token={TELEGRAM_WEBHOOK_SECRET}" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
```
Substituir `{TOKEN}`, `{PROJECT_REF}` e `{TELEGRAM_WEBHOOK_SECRET}` pelos valores reais.

---

## Verificação

| Cenário | Input | Resultado esperado |
|---|---|---|
| Texto livre | "quero apartamento 3 quartos em Manaíra" | Fotos + legenda + buttons |
| Mensagem vaga | "quero um imóvel" | Pergunta de refinamento (sem busca) |
| Refinamento | "agora só com piscina" | Busca atualizada com novo filtro |
| Áudio | Mensagem de voz com critérios | Transcrição + busca + fotos |
| Paginação | Clicar "Ver mais →" | Próximos 5 imóveis sem nova chamada Claude |
| Webhook inválido | POST sem secret token | HTTP 403 |

---

## Fora do Escopo (pós-validação)

- Migração para Supabase Queue (áudios longos / timeout)
- Controle de acesso por `chat_id`
- Módulo de follow-up (tabela `conversations` já preparada com coluna `filters`)
- Enriquecimento da tabela `imoveis` via skill `real-estate-ad-parser`
- Integração do agente na PWA (substituindo FilterPanel)
