# Deploy — Agente Telegram de Busca de Imóveis

## Pré-requisitos

- [ ] Supabase CLI instalado (`npm i -g supabase`)
- [ ] Projeto linkado: `supabase link --project-ref efwlpprsuygnhzksvibq`
- [ ] Bot Telegram criado via @BotFather (guarde o token)
- [ ] Conta Groq (https://console.groq.com) — obter API key para Whisper

## Nota

A migration `002_conversations.sql` já foi aplicada ao banco remoto. Não é necessário rodar `supabase db push`.

## Passo 1 — Configurar Secrets

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="<token do BotFather>" \
  TELEGRAM_WEBHOOK_SECRET="<string aleatória: openssl rand -hex 16>" \
  ANTHROPIC_API_KEY="<chave Anthropic>" \
  WHISPER_API_KEY="<chave Groq>" \
  WHISPER_PROVIDER="groq"
```

## Passo 2 — Deploy da Edge Function

```bash
cd C:/claudecode/workspace/radar-lopes
supabase functions deploy telegram-webhook --no-verify-jwt
```

URL da função após deploy:
`https://efwlpprsuygnhzksvibq.supabase.co/functions/v1/telegram-webhook`

## Passo 3 — Registrar Webhook no Telegram

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://efwlpprsuygnhzksvibq.supabase.co/functions/v1/telegram-webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","callback_query"]'
```

Resposta esperada: `{"ok":true,"result":true,"description":"Webhook was set"}`

## Passo 4 — Verificar Webhook

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Verifique: campo `"url"` preenchido, `"pending_update_count": 0`, sem erros.

## Passo 5 — Testes de Validação

Execute cada teste no bot do Telegram:

### Teste 1 — Texto livre
Enviar: `quero apartamento 3 quartos em Manaíra`
Esperado: resposta de texto + até 5 fotos com legenda e botões `[🔗 Ver anúncio]` e `[❤️ Salvar]`

### Teste 2 — Mensagem vaga (pergunta proativa)
Enviar: `quero comprar um imóvel`
Esperado: agente faz pelo menos 1 pergunta de refinamento **sem** enviar fotos

### Teste 3 — Refinamento incremental
Após Teste 2, responder: `apartamento, Cabo Branco, até 500 mil`
Esperado: agente busca e retorna fotos com filtros aplicados

### Teste 4 — Áudio
Enviar mensagem de voz descrevendo o imóvel desejado
Esperado: bot ecoa transcrição (`🎙️ "..."`) e retorna resultados

### Teste 5 — Paginação
Se busca retornar >5 imóveis, último card tem botão `[Ver mais →]`. Clicar.
Esperado: próximos 5 imóveis enviados

## Monitorar Logs

```bash
supabase functions logs telegram-webhook --tail
```
