# Telegram Card Detalhes Completos — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir endereço, valor de condomínio e todos os dados enriquecidos no card do bot Telegram de busca de imóveis.

**Architecture:** Migration SQL adiciona `endereco` e `valor_condominio` ao banco. O script de enriquecimento Python é atualizado para extrair `valor_condominio` via LLM. A Edge Function TypeScript é atualizada para incluir os novos campos na interface e no layout do card.

**Tech Stack:** PostgreSQL (Supabase), Python 3.12 + pytest, Deno + TypeScript (Supabase Edge Functions)

**Spec:** `docs/superpowers/specs/2026-03-16-telegram-card-detalhes-design.md`

---

## Chunk 1: Migration + Python Enrich

### Task 1: Criar migration 004

**Files:**
- Create: `supabase/migrations/004_condominio_endereco.sql`

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- Migration 004: Adicionar endereco e valor_condominio à tabela imoveis

ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS valor_condominio NUMERIC;
```

Salvar em `supabase/migrations/004_condominio_endereco.sql`.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/004_condominio_endereco.sql
git commit -m "feat(migration): adicionar colunas endereco e valor_condominio"
```

---

### Task 2: Testes unitários para parsear_resposta

**Files:**
- Create: `scraper/test_parsear_resposta.py`

- [ ] **Step 1: Escrever os testes (devem falhar antes das mudanças)**

```python
# scraper/test_parsear_resposta.py
"""Testes unitários para parsear_resposta em enrich_imoveis.py."""
import os
import sys

# Env vars antes do import (módulo lê no topo)
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "fake_key")
os.environ.setdefault("ANTHROPIC_API_KEY", "fake_key")

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))
from enrich_imoveis import parsear_resposta


def test_parsear_valor_condominio_numero():
    raw = '{"mobiliado": true, "valor_condominio": 600.0, "detalhes_imovel": {}}'
    resultado = parsear_resposta(raw)
    assert resultado["valor_condominio"] == 600.0


def test_parsear_valor_condominio_string_numerica():
    raw = '{"mobiliado": false, "valor_condominio": "800", "detalhes_imovel": {}}'
    resultado = parsear_resposta(raw)
    assert resultado["valor_condominio"] == 800.0


def test_parsear_valor_condominio_string_com_rs():
    raw = '{"mobiliado": null, "valor_condominio": "R$600/mês", "detalhes_imovel": {}}'
    resultado = parsear_resposta(raw)
    assert resultado["valor_condominio"] == 600.0


def test_parsear_valor_condominio_nulo():
    raw = '{"mobiliado": null, "valor_condominio": null, "detalhes_imovel": {}}'
    resultado = parsear_resposta(raw)
    assert resultado["valor_condominio"] is None


def test_parsear_valor_condominio_ausente():
    raw = '{"mobiliado": null, "detalhes_imovel": {}}'
    resultado = parsear_resposta(raw)
    assert resultado["valor_condominio"] is None


def test_parsear_valor_condominio_negativo_vira_none():
    raw = '{"mobiliado": null, "valor_condominio": -50, "detalhes_imovel": {}}'
    resultado = parsear_resposta(raw)
    assert resultado["valor_condominio"] is None


def test_parsear_retorno_inclui_chave_valor_condominio():
    """Garantir que a chave existe mesmo quando None."""
    raw = '{"mobiliado": null, "detalhes_imovel": {}}'
    resultado = parsear_resposta(raw)
    assert "valor_condominio" in resultado
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
cd /c/claudecode/workspace/radar-lopes/scraper
.venv/Scripts/python -m pytest test_parsear_resposta.py -v
```

Esperado: vários FAILED (KeyError ou AssertionError — `valor_condominio` não existe no retorno ainda).

---

### Task 3: Atualizar parsear_resposta

**Files:**
- Modify: `scraper/enrich_imoveis.py`

- [ ] **Step 1: Atualizar DETALHES_FALLBACK**

Localizar:
```python
DETALHES_FALLBACK = {
    "mobiliado": None,
    "detalhes_imovel": None,
}
```

Substituir por:
```python
DETALHES_FALLBACK = {
    "mobiliado": None,
    "valor_condominio": None,
    "detalhes_imovel": None,
}
```

- [ ] **Step 2: Atualizar parsear_resposta — adicionar extração de valor_condominio**

Localizar o bloco que extrai `mobiliado` (logo após `resultado = json.loads(raw)`):
```python
    mobiliado = resultado.get("mobiliado")
    if not isinstance(mobiliado, bool):
        mobiliado = None
```

Adicionar logo após esse bloco:
```python
    # Extrai valor_condominio como número positivo
    valor_cond_raw = resultado.get("valor_condominio")
    if isinstance(valor_cond_raw, (int, float)) and valor_cond_raw > 0:
        valor_cond = float(valor_cond_raw)
    elif isinstance(valor_cond_raw, str):
        try:
            cleaned = re.sub(r"[^\d.,]", "", valor_cond_raw).replace(",", ".")
            parsed = float(cleaned) if cleaned else 0
            valor_cond = parsed if parsed > 0 else None
        except (ValueError, TypeError):
            valor_cond = None
    else:
        valor_cond = None
```

- [ ] **Step 3: Atualizar return de parsear_resposta**

Localizar:
```python
    return {
        "mobiliado":      mobiliado,
        "detalhes_imovel": detalhes if detalhes else None,
    }
```

Substituir por:
```python
    return {
        "mobiliado":       mobiliado,
        "valor_condominio": valor_cond,
        "detalhes_imovel": detalhes if detalhes else None,
    }
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

```bash
cd /c/claudecode/workspace/radar-lopes/scraper
.venv/Scripts/python -m pytest test_parsear_resposta.py -v
```

Esperado: 7 PASSED.

---

### Task 4: Atualizar prompt e upsert

**Files:**
- Modify: `scraper/enrich_imoveis.py`

> **Nota:** `endereco` NÃO é extraído pelo LLM — já é capturado pelo scraper (Fase 2 httpx, linha 505 de `scraper.py`) e salvo diretamente via `upsert_imovel`. A nova coluna `endereco` da migration 004 é suficiente para que o dado comece a persistir. O enrich só precisa adicionar `valor_condominio`.

- [ ] **Step 1: Atualizar montar_user_prompt**

Localizar:
```python
        'Retorne JSON com exatamente estas chaves:\n'
        '{\n'
        '  "mobiliado": true|false|null,\n'
        '  "detalhes_imovel": {\n'
```

Substituir por:
```python
        'Retorne JSON com exatamente estas chaves:\n'
        '{\n'
        '  "mobiliado": true|false|null,\n'
        '  "valor_condominio": 600.0,\n'
        '  "detalhes_imovel": {\n'
```

- [ ] **Step 2: Atualizar atualizar_imovel para incluir valor_condominio**

Localizar:
```python
        supabase.table("imoveis").update({
            "detalhes_imovel": dados["detalhes_imovel"],
            "mobiliado":       dados["mobiliado"],
        }).eq("id", imovel_id).execute()
```

Substituir por:
```python
        supabase.table("imoveis").update({
            "detalhes_imovel":  dados["detalhes_imovel"],
            "mobiliado":        dados["mobiliado"],
            "valor_condominio": dados["valor_condominio"],
        }).eq("id", imovel_id).execute()
```

- [ ] **Step 3: Rodar todos os testes para confirmar que nada quebrou**

```bash
cd /c/claudecode/workspace/radar-lopes/scraper
.venv/Scripts/python -m pytest test_parsear_resposta.py -v
```

Esperado: 7 PASSED.

- [ ] **Step 4: Commit**

```bash
git add scraper/enrich_imoveis.py scraper/test_parsear_resposta.py
git commit -m "feat(enrich): extrair valor_condominio numerico via LLM"
```

---

## Chunk 2: TypeScript — Telegram Card

### Task 5: Testes para novos campos do formatCaption

**Files:**
- Modify: `supabase/functions/telegram-webhook/_tests/telegram_test.ts`

- [ ] **Step 1: Adicionar testes que devem falhar antes das mudanças**

Ao final de `telegram_test.ts`, adicionar:

```typescript
Deno.test("formatCaption - exibe endereco quando presente", () => {
  const imovel = {
    titulo: "Apto Manaíra",
    bairro: "Manaíra",
    tipo: "Apartamento",
    quartos: 3,
    suites: 1,
    garagem: 1,
    area_m2: 90,
    preco: 500000,
    url: "https://lopesdeandrade.com.br/imovel/123",
    endereco: "Rua das Flores, 123",
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🗺 Rua das Flores, 123"), true);
});

Deno.test("formatCaption - omite linha endereco quando null", () => {
  const imovel = {
    titulo: "Apto Bessa",
    bairro: "Bessa",
    tipo: "Apartamento",
    quartos: 2,
    suites: null,
    garagem: null,
    area_m2: 70,
    preco: 300000,
    url: "https://lopesdeandrade.com.br/imovel/456",
    endereco: null,
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🗺"), false);
});

Deno.test("formatCaption - exibe condominio inline com preco", () => {
  const imovel = {
    titulo: "Apto Cabo Branco",
    bairro: "Cabo Branco",
    tipo: "Apartamento",
    quartos: 3,
    suites: 1,
    garagem: 2,
    area_m2: 100,
    preco: 750000,
    url: "https://lopesdeandrade.com.br/imovel/789",
    valor_condominio: 600,
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🏢 Cond."), true);
  assertEquals(caption.includes("R$ 600"), true);
});

Deno.test("formatCaption - exibe acabamentos e amenidades", () => {
  const imovel = {
    titulo: "Apto Tambaú",
    bairro: "Tambaú",
    tipo: "Apartamento",
    quartos: 3,
    suites: 2,
    garagem: 2,
    area_m2: 120,
    preco: 900000,
    url: "https://lopesdeandrade.com.br/imovel/abc",
    detalhes_imovel: {
      acabamentos: ["piso porcelanato", "cozinha planejada", "ar-condicionado"],
      condominio: ["piscina", "academia", "portaria 24h"],
      localizacao_detalhes: ["a 200m da praia"],
      observacoes_extras: ["IPTU R$ 120/mês"],
    },
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🪟"), true);
  assertEquals(caption.includes("piso porcelanato"), true);
  assertEquals(caption.includes("🏊"), true);
  assertEquals(caption.includes("piscina"), true);
  assertEquals(caption.includes("📌"), true);
  assertEquals(caption.includes("📝"), true);
  assertEquals(caption.includes("IPTU R$ 120/mês"), true);
});

Deno.test("formatCaption - trunca endereco longo", () => {
  const imovel = {
    titulo: "Apto",
    bairro: "Bairro",
    tipo: "Apartamento",
    quartos: 2,
    suites: null,
    garagem: null,
    area_m2: 60,
    preco: 200000,
    url: "https://lopesdeandrade.com.br/imovel/trunc",
    endereco: "Avenida Presidente Epitácio Pessoa, número 1500, Bloco B, Apartamento 402",
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.includes("🗺"), true);
  // linha de endereço deve ter no máximo 63 chars (3 de "🗺 " + 60 de endereço)
  const lines = caption.split("\n");
  const endLine = lines.find((l) => l.startsWith("🗺"));
  assertEquals(endLine !== undefined, true);
  assertEquals(endLine!.length <= 65, true); // 🗺 + espaço + 60 chars + possível …
});

Deno.test("formatCaption - caption nao excede 1024 chars", () => {
  const imovel = {
    titulo: "Título muito longo ".repeat(10),
    bairro: "Bairro",
    tipo: "Apartamento",
    quartos: 4,
    suites: 3,
    garagem: 3,
    area_m2: 200,
    preco: 1500000,
    valor_condominio: 1200,
    url: "https://lopesdeandrade.com.br/imovel/long",
    endereco: "Rua muito longa mesmo de verdade, número 9999, Apartamento 101",
    detalhes_imovel: {
      estado_imovel: "reformado",
      diferenciais: ["sol da manhã", "vista mar", "andar alto"],
      acabamentos: ["piso porcelanato", "cozinha planejada", "ar-condicionado"],
      condominio: ["piscina", "academia", "portaria 24h"],
      localizacao_detalhes: ["a 200m da praia", "próximo ao shopping"],
      observacoes_extras: ["IPTU R$ 200/mês", "semi-mobiliado", "pronto para morar"],
    },
  };
  const caption = formatCaption(imovel);
  assertEquals(caption.length <= 1024, true);
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

```bash
cd /c/claudecode/workspace/radar-lopes
deno test --allow-net supabase/functions/telegram-webhook/_tests/telegram_test.ts
```

Esperado: testes novos FAILED (propriedades `endereco`, `valor_condominio` não reconhecidas na interface / não renderizadas no caption).

---

### Task 6: Atualizar Imovel interface e formatCaption

**Files:**
- Modify: `supabase/functions/telegram-webhook/modules/telegram.ts`

- [ ] **Step 1: Substituir a interface Imovel**

Localizar o bloco completo:
```typescript
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
  mobiliado?: boolean | null;
  detalhes_imovel?: {
    estado_imovel?: string | null;
    diferenciais?: string[] | null;
  } | null;
}
```

Substituir por:
```typescript
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
```

- [ ] **Step 2: Substituir a função formatCaption**

Localizar o bloco completo de `formatCaption` (linhas 66–97) e substituir por:

```typescript
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
      ? imovel.endereco.slice(0, 57) + "…"
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
```

- [ ] **Step 3: Verificar tipos com deno check**

```bash
cd /c/claudecode/workspace/radar-lopes
deno check supabase/functions/telegram-webhook/modules/telegram.ts
```

Esperado: sem erros de tipo.

- [ ] **Step 4: Rodar todos os testes**

```bash
cd /c/claudecode/workspace/radar-lopes
deno test --allow-net supabase/functions/telegram-webhook/_tests/telegram_test.ts
```

Esperado: todos os testes PASSED (incluindo os 5 existentes + 6 novos = 11 total).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/telegram-webhook/modules/telegram.ts
git add supabase/functions/telegram-webhook/_tests/telegram_test.ts
git commit -m "feat(telegram): card com endereco, condominio e dados enriquecidos completos"
```

---

## Chunk 3: Apply + Deploy + Re-enrich

### Task 7: Aplicar migration no banco

- [ ] **Step 1: Aplicar migration via Supabase MCP**

Usar a ferramenta `mcp__claude_ai_Supabase__apply_migration` ou `mcp__plugin_supabase_supabase__apply_migration` com o conteúdo:

```sql
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS valor_condominio NUMERIC;
```

Nome da migration: `004_condominio_endereco`

- [ ] **Step 2: Confirmar colunas no banco**

Executar SQL de verificação via `execute_sql`:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'imoveis'
  AND column_name IN ('endereco', 'valor_condominio');
```

Esperado: 2 linhas — `endereco TEXT` e `valor_condominio NUMERIC`.

---

### Task 8: Deploy da Edge Function

- [ ] **Step 1: Deploy via Supabase MCP ou CLI**

```bash
cd /c/claudecode/workspace/radar-lopes
supabase functions deploy telegram-webhook --no-verify-jwt
```

Esperado: `Deployed Functions telegram-webhook`.

---

### Task 9: Re-enrich dos imóveis existentes

- [ ] **Step 1: Testar com 5 imóveis primeiro**

```bash
cd /c/claudecode/workspace/radar-lopes/scraper
.venv/Scripts/python enrich_imoveis.py --test 5
```

Esperado: 5 imóveis processados. Verificar no output que `valor_condominio` aparece para ao menos 1 imóvel com condomínio na descrição.

- [ ] **Step 2: Validar no banco que valor_condominio e endereco foram salvos**

Via Supabase MCP (`execute_sql`):
```sql
SELECT titulo, valor_condominio, endereco
FROM imoveis
WHERE valor_condominio IS NOT NULL
   OR endereco IS NOT NULL
LIMIT 10;
```

Esperado: pelo menos 1 resultado com `valor_condominio` e pelo menos 1 com `endereco` preenchido.

- [ ] **Step 3: Re-enrich completo (somente após validação)**

```bash
cd /c/claudecode/workspace/radar-lopes/scraper
.venv/Scripts/python enrich_imoveis.py --force
```

- [ ] **Step 4: Commit final**

```bash
git add .
git commit -m "chore: re-enrich completo com valor_condominio"
```
