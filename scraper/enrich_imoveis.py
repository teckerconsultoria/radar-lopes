#!/usr/bin/env python3
"""
Radar Lopes — Enriquecimento Qualitativo de Imóveis
Usa a Batch API do Anthropic para extrair dados qualitativos da descrição
dos imóveis e salvar em detalhes_imovel (JSONB) e mobiliado (BOOLEAN).

Uso:
    python enrich_imoveis.py           # processa apenas detalhes_imovel IS NULL
    python enrich_imoveis.py --force   # reprocessa todos (ignora enriched)
    python enrich_imoveis.py --test 5  # testa com 5 imóveis
"""

import re
import sys
import time
import json
import argparse
import logging
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv
import os

from supabase import create_client, Client
import anthropic

load_dotenv(override=True)

# ── Logger ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("enrich")

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_KEY  = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
LLM_MODEL     = "claude-haiku-4-5-20251001"
LLM_MAX_TOKENS = 512

SYSTEM_PROMPT = (
    "Você é um extrator de dados qualitativos de anúncios imobiliários brasileiros.\n"
    "Analise a descrição fornecida e retorne SOMENTE um objeto JSON válido, "
    "sem texto adicional, markdown ou explicações.\n\n"
    "Regras:\n"
    "- Use null para campos não mencionados ou incertos\n"
    "- Omita chaves com arrays vazios\n"
    "- Não repita dados estruturais (quartos, área, preço, bairro)\n"
    "- Seja conciso: máximo 8 itens por array"
)

DETALHES_FALLBACK = {
    "mobiliado": None,
    "valor_condominio": None,
    "detalhes_imovel": None,
}


# ── Supabase ──────────────────────────────────────────────────────────────────
def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def buscar_pendentes(supabase: Client, force: bool, limite: int | None) -> list[dict]:
    """Busca imóveis que precisam de enriquecimento."""
    query = (
        supabase.table("imoveis")
        .select("id, descricao, titulo")
        .eq("status", "ativo")
        .not_.is_("descricao", "null")
    )
    if not force:
        query = query.is_("detalhes_imovel", "null")
    if limite:
        query = query.limit(limite)

    res = query.execute()
    return res.data or []


# ── Prompt ────────────────────────────────────────────────────────────────────
def montar_user_prompt(titulo: str, descricao: str) -> str:
    return (
        f"Título: {titulo}\n"
        f"Descrição: {descricao}\n\n"
        'Retorne JSON com exatamente estas chaves:\n'
        '{\n'
        '  "mobiliado": true|false|null,\n'
        '  "valor_condominio": 600.0,\n'
        '  "detalhes_imovel": {\n'
        '    "estado_imovel": "novo"|"reformado"|"bem conservado"|"precisa reforma"|null,\n'
        '    "diferenciais": ["sol da manhã", "andar alto", "vista mar", ...],\n'
        '    "acabamentos": ["piso porcelanato", "cozinha planejada", "ar-condicionado", ...],\n'
        '    "condominio": ["piscina", "academia", "portaria 24h", ...],\n'
        '    "localizacao_detalhes": ["próximo ao shopping", "a 200m da praia", ...],\n'
        '    "observacoes_extras": ["condomínio R$600/mês", "IPTU R$120/mês", "semi-mobiliado", ...]\n'
        '  }\n'
        '}'
    )


# ── Parse da resposta ─────────────────────────────────────────────────────────
def parsear_resposta(raw: str) -> dict:
    """Parseia JSON retornado pelo LLM. Lança exceção em caso de falha."""
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw).strip()

    resultado = json.loads(raw)

    mobiliado = resultado.get("mobiliado")
    if not isinstance(mobiliado, bool):
        mobiliado = None

    # Extrai valor_condominio como número positivo
    valor_cond_raw = resultado.get("valor_condominio")
    if isinstance(valor_cond_raw, (int, float)) and valor_cond_raw > 0:
        valor_cond = float(valor_cond_raw)
    elif isinstance(valor_cond_raw, str):
        try:
            s = re.sub(r"[^\d,.]", "", valor_cond_raw)
            if not s:
                valor_cond = None
            elif "," in s:
                # Formato BR: ponto é milhar, vírgula é decimal → "1.200,50" → 1200.5
                s = s.replace(".", "").replace(",", ".")
                parsed = float(s)
                valor_cond = parsed if parsed > 0 else None
            elif re.match(r"^\d{1,3}(\.\d{3})+$", s):
                # Ponto de milhar sem centavos → "1.200" → 1200.0
                s = s.replace(".", "")
                parsed = float(s)
                valor_cond = parsed if parsed > 0 else None
            else:
                # Decimal normal → "600.50" → 600.5
                parsed = float(s)
                valor_cond = parsed if parsed > 0 else None
        except (ValueError, TypeError):
            valor_cond = None
    else:
        valor_cond = None

    detalhes_raw = resultado.get("detalhes_imovel") or {}
    if not isinstance(detalhes_raw, dict):
        detalhes_raw = {}

    # Limpar arrays — remover itens vazios, garantir lowercase
    def clean_array(v) -> list[str] | None:
        if not isinstance(v, list):
            return None
        itens = [str(x).lower().strip() for x in v if x and str(x).strip()]
        return itens if itens else None

    detalhes = {}
    estado = detalhes_raw.get("estado_imovel")
    if estado and isinstance(estado, str):
        detalhes["estado_imovel"] = estado.strip()

    for chave in ("diferenciais", "acabamentos", "condominio", "localizacao_detalhes", "observacoes_extras"):
        val = clean_array(detalhes_raw.get(chave))
        if val:
            detalhes[chave] = val

    return {
        "mobiliado":       mobiliado,
        "valor_condominio": valor_cond,
        "detalhes_imovel": detalhes if detalhes else None,
    }


# ── Batch API ─────────────────────────────────────────────────────────────────
def executar_batch(imoveis: list[dict]) -> dict[str, dict]:
    """
    Envia todos os imóveis para a Batch API.
    Retorna dict: id_str → {mobiliado, detalhes_imovel}.
    """
    anth = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    batch_requests = [
        {
            "custom_id": f"enrich-{item['id']}",
            "params": {
                "model":      LLM_MODEL,
                "max_tokens": LLM_MAX_TOKENS,
                "system":     SYSTEM_PROMPT,
                "messages":   [{
                    "role":    "user",
                    "content": montar_user_prompt(
                        item.get("titulo") or "",
                        item.get("descricao") or "",
                    ),
                }],
            },
        }
        for item in imoveis
    ]

    print(f"  Submetendo {len(batch_requests)} requests à Batch API...")
    batch = anth.messages.batches.create(requests=batch_requests)
    print(f"  Batch ID: {batch.id} | Status: {batch.processing_status}")
    log.info(f"Batch criado: {batch.id}")

    while batch.processing_status != "ended":
        time.sleep(15)
        batch = anth.messages.batches.retrieve(batch.id)
        rc = batch.request_counts
        print(
            f"  Aguardando... processando={rc.processing} "
            f"concluídos={rc.succeeded} erros={rc.errored}"
        )

    print(f"  ✓ Batch concluído — {batch.request_counts.succeeded} sucessos, "
          f"{batch.request_counts.errored} erros")
    log.info(f"Batch {batch.id} concluído: {batch.request_counts}")

    resultados = {}
    for result in anth.messages.batches.results(batch.id):
        cid = result.custom_id  # "enrich-<uuid>"
        imovel_id = cid[len("enrich-"):]
        try:
            raw = result.result.message.content[0].text.strip()
            resultados[imovel_id] = parsear_resposta(raw)
        except Exception as e:
            log.warning(f"[Batch] falha em {cid}: {e} — usando fallback")
            resultados[imovel_id] = DETALHES_FALLBACK.copy()

    return resultados


# ── Upsert ────────────────────────────────────────────────────────────────────
def atualizar_imovel(supabase: Client, imovel_id: str, dados: dict) -> bool:
    """Atualiza detalhes_imovel e mobiliado pelo id."""
    try:
        supabase.table("imoveis").update({
            "detalhes_imovel":  dados["detalhes_imovel"],
            "mobiliado":        dados["mobiliado"],
            "valor_condominio": dados["valor_condominio"],
        }).eq("id", imovel_id).execute()
        return True
    except Exception as e:
        log.error(f"Erro ao atualizar {imovel_id}: {e}")
        return False


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Enriquecimento qualitativo de imóveis")
    parser.add_argument("--force", action="store_true", help="Reprocessa mesmo com detalhes_imovel preenchido")
    parser.add_argument("--test",  type=int, metavar="N", help="Testa com N imóveis apenas")
    args = parser.parse_args()

    supabase = get_supabase()
    inicio = datetime.utcnow()

    print("=" * 60)
    print("  Radar Lopes — Enriquecimento de Imóveis")
    print(f"  Iniciado: {inicio.strftime('%d/%m/%Y %H:%M:%S')}")
    if args.force:
        print("  Modo: FORCE (reprocessa todos)")
    if args.test:
        print(f"  Modo: TESTE (limite {args.test})")
    print("=" * 60)

    # Buscar pendentes
    imoveis = buscar_pendentes(supabase, force=args.force, limite=args.test)
    print(f"\n  {len(imoveis)} imóveis para processar")

    if not imoveis:
        print("  Nenhum imóvel pendente. Encerrando.")
        return

    # Executar batch
    print("\n[BATCH] Enviando para Anthropic Batch API...")
    resultados = executar_batch(imoveis)

    # Atualizar Supabase
    print(f"\n[UPSERT] Atualizando {len(imoveis)} imóveis no Supabase...")
    atualizados = 0
    erros = 0
    mobiliados_count = 0

    for item in imoveis:
        iid = str(item["id"])
        dados = resultados.get(iid, DETALHES_FALLBACK.copy())
        ok = atualizar_imovel(supabase, iid, dados)

        if ok:
            atualizados += 1
            if dados.get("mobiliado") is True:
                mobiliados_count += 1
            status = "mobiliado" if dados.get("mobiliado") is True else (
                "não mobiliado" if dados.get("mobiliado") is False else "s/info"
            )
            titulo_curto = (item.get("titulo") or "")[:50]
            print(f"  ✓ {titulo_curto} | {status}")
        else:
            erros += 1
            print(f"  ✗ {item['id']} | erro no update")

    fim = datetime.utcnow()
    duracao = (fim - inicio).seconds

    print("\n" + "=" * 60)
    print("  RELATÓRIO")
    print("=" * 60)
    print(f"  Processados : {len(imoveis)}")
    print(f"  Atualizados : {atualizados}")
    print(f"  Mobiliados  : {mobiliados_count}")
    print(f"  Erros       : {erros}")
    print(f"  Duração     : {duracao // 60}m {duracao % 60}s")
    print("=" * 60)


if __name__ == "__main__":
    main()
