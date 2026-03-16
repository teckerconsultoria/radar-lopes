# Design: Card do Telegram com Detalhes Completos do Anúncio

**Data:** 2026-03-16
**Status:** Aprovado
**Projeto:** radar-lopes — Bot Telegram

---

## Problema

O card do Telegram exibia dados mínimos do imóvel (título, bairro, tipo, quartos, área, preço, mobiliado, estado e 2 diferenciais). Três lacunas principais:

1. **Endereço ausente** — o scraper já extrai o logradouro do site, mas a tabela `imoveis` não tinha a coluna `endereco`, descartando o dado silenciosamente no upsert.
2. **Valor de condomínio desestruturado** — aparecia apenas como texto livre em `observacoes_extras` (ex: "condomínio R$600/mês"), sem coluna numérica dedicada.
3. **Dados enriquecidos subutilizados** — a migration 003 adicionou `detalhes_imovel` JSONB com 6 subcampos (`estado_imovel`, `diferenciais`, `acabamentos`, `condominio`, `localizacao_detalhes`, `observacoes_extras`), mas o card mostrava apenas 2 deles.

---

## Solução

Pipeline completo em três camadas: banco → enriquecimento → card.

---

## Arquitetura

### 1. Migration `004_condominio_endereco.sql`

```sql
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS valor_condominio NUMERIC;
```

- `endereco`: destrava dado já capturado pelo scraper (linha 732 de `scraper.py`)
- `valor_condominio`: recebe valor numérico em R$ extraído pelo LLM

### 2. `scraper/enrich_imoveis.py`

**Prompt atualizado** — adiciona instrução para extrair `valor_condominio` como número no nível raiz do JSON:

```json
{
  "mobiliado": true|false|null,
  "valor_condominio": 600.0,
  "detalhes_imovel": { ... }
}
```

**`parsear_resposta`** — extrai e valida o número:

```python
valor_cond = resultado.get("valor_condominio")
if not isinstance(valor_cond, (int, float)):
    valor_cond = None
```

**`atualizar_imovel`** — inclui o campo no UPDATE:

```python
supabase.table("imoveis").update({
    "detalhes_imovel": dados["detalhes_imovel"],
    "mobiliado":       dados["mobiliado"],
    "valor_condominio": dados["valor_condominio"],
}).eq("id", imovel_id).execute()
```

Re-enrich com `--force` popula `valor_condominio` em todos os imóveis existentes.

### 3. `supabase/functions/telegram-webhook/modules/telegram.ts`

#### Interface `Imovel` — novos campos

```typescript
export interface Imovel {
  url: string;
  titulo: string;
  tipo: string | null;
  bairro: string | null;
  endereco?: string | null;           // novo
  preco: number | null;
  valor_condominio?: number | null;   // novo
  area_m2: number | null;
  quartos: number | null;
  suites: number | null;
  garagem: number | null;
  fotos: string[] | null;
  mobiliado?: boolean | null;
  detalhes_imovel?: {
    estado_imovel?: string | null;
    diferenciais?: string[] | null;
    acabamentos?: string[] | null;        // novo
    condominio?: string[] | null;         // novo (amenidades)
    localizacao_detalhes?: string[] | null; // novo
    observacoes_extras?: string[] | null; // novo
  } | null;
}
```

#### `formatCaption` — layout do card

```
🏠 Título
📍 Bairro · Tipo
🗺 Rua das Flores, 123 — Manaíra        (se endereco existir)
🛏 3q · 🚿 2s · 🚗 2 · 📐 120m²
💰 R$ 450.000  |  🏢 Cond. R$ 600       (condomínio inline com preço, se existir)
✅ Mobiliado  ✔️ Bem conservado          (mobiliado + estado_imovel)
🌟 Sol da manhã · Vista mar             (diferenciais, todos)
🪟 Piso porcelanato · Cozinha planejada  (acabamentos, até 3)
🏊 Piscina · Academia · Portaria 24h    (amenidades condomínio, até 3)
📌 A 200m da praia · Perto do shopping  (localizacao_detalhes, até 2)
📝 IPTU R$ 120/mês · Semi-mobiliado     (observacoes_extras, até 3)
```

Linhas com valor `null` ou array vazio são omitidas. Regras de truncagem:

- Arrays: `slice` por campo (acabamentos ≤3, amenidades ≤3, localização ≤2, observações ≤3)
- Endereço: truncar em 60 chars com `…` se ultrapassar
- Fallback final: se o caption completo exceder 1020 chars, truncar com `caption.slice(0, 1020) + "…"`

**`valor_condominio` parse**: se LLM retornar string (ex: `"600"` ou `"R$600"`), tentar `parseFloat` antes de rejeitar como null. Aceitar apenas números positivos.

---

## Fluxo de Dados

```
lopesdeandrade.com.br
        ↓ scraper.py (Playwright + httpx)
imoveis.endereco (TEXT)         ← já extraído, agora persiste
imoveis.preco, quartos...
        ↓ enrich_imoveis.py (Batch API — Haiku)
imoveis.valor_condominio (NUMERIC)
imoveis.detalhes_imovel (JSONB)
        ↓ buscarImoveis() — select("*")
telegram-webhook / formatCaption
        ↓
Card Telegram (caption enriquecido)
```

`buscarImoveis` já usa `select("*")` — as novas colunas chegam automaticamente sem mudança no `search.ts`.

---

## Arquivos Modificados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/004_condominio_endereco.sql` | Novo — adiciona colunas |
| `scraper/enrich_imoveis.py` | Atualiza prompt + parse + upsert |
| `supabase/functions/telegram-webhook/modules/telegram.ts` | Interface + formatCaption |

---

## Pós-Deploy

Após aplicar a migration e fazer deploy da Edge Function:

```bash
cd scraper
python enrich_imoveis.py --test 5  # validar com 5 imóveis primeiro
python enrich_imoveis.py --force   # re-processa todos os imóveis
```

Validação: confirmar no Supabase que `valor_condominio` está populado em imóveis cujas descrições mencionam condomínio.
