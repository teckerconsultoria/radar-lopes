#!/usr/bin/env python3
"""
Radar Lopes — Importador de CSV
Importa dados do CSV de base para o Supabase como ponto de partida.

Uso:
    python import_csv.py "../Tabela de Anúncios Imobiliários - Table 1.csv"
"""

import csv
import sys
import os
import re
from datetime import datetime
from urllib.parse import urlparse

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

BASE_URL = "https://lopesdeandrade.com.br/imovel"


def limpar_inteiro(val: str) -> int | None:
    if not val or val.strip() in ("", "-", "N/A"):
        return None
    try:
        return int(float(val.strip()))
    except ValueError:
        return None


def limpar_data(val: str) -> str | None:
    """Converte DD/MM/YYYY → YYYY-MM-DD."""
    if not val or val.strip() in ("", "-"):
        return None
    match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", val.strip())
    if match:
        d, m, a = match.groups()
        return f"{a}-{m.zfill(2)}-{d.zfill(2)}"
    return None


def processar_linha(row: dict) -> dict | None:
    slug = row.get("url", "").strip()
    if not slug:
        return None

    # Se a url parece um slug (sem http), constrói a URL completa
    if not slug.startswith("http"):
        url = f"{BASE_URL}/{slug}"
    else:
        url = slug
        slug = urlparse(url).path.rstrip("/").split("/")[-1]

    titulo = row.get("anuncio", "").strip()
    if not titulo:
        titulo = f"Imóvel — {slug}"

    tipo = row.get("Tipo de Imóvel (Inferred)", "").strip() or None
    bairro = row.get("Bairro (Inferred)", "").strip() or None
    quartos = limpar_inteiro(row.get("Quartos (Inferred)", ""))
    suites = limpar_inteiro(row.get("Suítes (Inferred)", ""))
    ultima_mod = limpar_data(row.get("Última Modificação", ""))
    fonte = limpar_inteiro(row.get("Fonte", "1")) or 1

    return {
        "url": url,
        "slug": slug,
        "titulo": titulo,
        "tipo": tipo,
        "bairro": bairro,
        "quartos": quartos,
        "suites": suites,
        "ultima_modificacao": ultima_mod,
        "fonte": fonte,
        "status": "ativo",
        "scraped_at": datetime.utcnow().isoformat(),
    }


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else "../Tabela de Anúncios Imobiliários - Table 1.csv"

    if not os.path.exists(csv_path):
        print(f"Arquivo não encontrado: {csv_path}")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    inseridos = atualizados = erros = 0

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        linhas = list(reader)

    print(f"Importando {len(linhas)} registros de {csv_path}...")
    print("─" * 60)

    for i, row in enumerate(linhas, 1):
        dados = processar_linha(row)
        if not dados:
            print(f"  [{i:>3}] ✗ sem URL, pulada")
            erros += 1
            continue

        try:
            res = supabase.table("imoveis").select("id").eq("url", dados["url"]).execute()
            if res.data:
                supabase.table("imoveis").update(dados).eq("url", dados["url"]).execute()
                atualizados += 1
                acao = "↻"
            else:
                supabase.table("imoveis").insert(dados).execute()
                inseridos += 1
                acao = "+"
            print(f"  [{i:>3}] {acao} {dados['titulo'][:55]}")
        except Exception as e:
            erros += 1
            print(f"  [{i:>3}] ✗ {e}")

    print("\n─── Resumo ───────────────────────────")
    print(f"  Total      : {len(linhas)}")
    print(f"  Inseridos  : {inseridos}")
    print(f"  Atualizados: {atualizados}")
    print(f"  Erros      : {erros}")
    print("──────────────────────────────────────")


if __name__ == "__main__":
    main()
