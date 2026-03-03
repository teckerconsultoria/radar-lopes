#!/usr/bin/env python3
"""
Radar Lopes — Scraper de Imóveis
Extrai anúncios do site lopesdeandrade.com.br e salva no Supabase.

Uso:
    python scraper.py           # scraping completo
    python scraper.py --test 5  # testa com 5 imóveis
"""

import re
import sys
import time
import random
import argparse
import traceback
from datetime import datetime, date
from urllib.parse import urljoin, urlparse

from dotenv import load_dotenv
import os

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from bs4 import BeautifulSoup
from supabase import create_client, Client

load_dotenv()

# ── Configurações ──────────────────────────────────────────────────────────────
BASE_URL = "https://lopesdeandrade.com.br"
LISTING_PATH = "/imoveis"
DELAY_MIN = 1.5
DELAY_MAX = 3.0
PAGE_TIMEOUT = 30_000  # ms

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

# ── Palavras-chave para extração semântica ─────────────────────────────────────
CARACTERISTICAS_KEYWORDS = [
    "piscina", "varanda", "sacada", "churrasqueira", "área de lazer",
    "playground", "academia", "salão de festas", "quadra", "elevador",
    "portaria 24h", "segurança", "condomínio fechado", "gourmet",
    "vista mar", "nascente", "poente", "reformado", "novo", "moderno",
    "ar condicionado", "cozinha americana", "closet", "despensa",
    "lavanderia", "dependência", "interfone", "câmeras", "gerador",
    "energia solar", "cabeamento estruturado",
]

POIS_PATTERNS = [
    r"shopping\s+\w+",
    r"praia\s+d[aeo]\s+\w+",
    r"ufpb|unifacisa|unipê|iesp",
    r"hospital\s+\w+",
    r"colégio\s+\w+",
    r"escola\s+\w+",
    r"mercado\s+\w+",
    r"supermercado\s+\w+",
    r"parque\s+\w+",
    r"av(?:enida)?\s+\w+",
    r"\d+\s*m\s+d[ao]",
    r"próximo\s+(?:ao?|à)\s+\w+",
    r"a\s+\d+\s*m(?:etros)?\s+d[ao]",
]


# ── Supabase ──────────────────────────────────────────────────────────────────
def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ── Extração de texto ─────────────────────────────────────────────────────────
def extrair_numero(texto: str) -> float | None:
    """Extrai primeiro número de uma string."""
    if not texto:
        return None
    match = re.search(r"[\d.,]+", texto.replace(".", "").replace(",", "."))
    if match:
        try:
            return float(match.group())
        except ValueError:
            return None
    return None


def extrair_preco(texto: str) -> float | None:
    """Extrai preço em reais de uma string."""
    if not texto:
        return None
    clean = re.sub(r"[R$\s]", "", texto).replace(".", "").replace(",", ".")
    match = re.search(r"[\d.]+", clean)
    if match:
        try:
            return float(match.group())
        except ValueError:
            return None
    return None


def extrair_area(texto: str) -> float | None:
    """Extrai área em m² de uma string."""
    if not texto:
        return None
    match = re.search(r"([\d.,]+)\s*m", texto.replace(",", "."))
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


def extrair_caracteristicas(descricao: str) -> list[str]:
    """Identifica características implícitas na descrição."""
    if not descricao:
        return []
    texto = descricao.lower()
    encontradas = []
    for kw in CARACTERISTICAS_KEYWORDS:
        if kw in texto:
            encontradas.append(kw)
    return list(set(encontradas))


def extrair_pois(descricao: str) -> list[str]:
    """Identifica POIs mencionados na descrição."""
    if not descricao:
        return []
    texto = descricao.lower()
    encontrados = []
    for pattern in POIS_PATTERNS:
        matches = re.findall(pattern, texto)
        encontrados.extend(matches)
    return list(set(encontrados))


def extrair_slug(url: str) -> str:
    """Extrai slug da URL."""
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    return parts[-1] if parts else url


# ── Scraping ──────────────────────────────────────────────────────────────────
def listar_slugs(page) -> list[str]:
    """Coleta todos os slugs de anúncios ativos via paginação."""
    slugs = []
    pagina = 1

    while True:
        url = f"{BASE_URL}{LISTING_PATH}?pagina={pagina}"
        print(f"  → Listagem página {pagina}: {url}")

        try:
            page.goto(url, timeout=PAGE_TIMEOUT, wait_until="networkidle")
            time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
        except PlaywrightTimeout:
            print(f"    ⚠ Timeout na página {pagina}, encerrando listagem.")
            break

        soup = BeautifulSoup(page.content(), "lxml")

        # Tenta diferentes seletores comuns em sites de imóveis
        links = []
        for selector in [
            "a[href*='/imovel/']",
            "a[href*='/imoveis/']",
            ".property-item a",
            ".imovel a",
            "article a",
        ]:
            links = soup.select(selector)
            if links:
                break

        if not links:
            # Tenta buscar por padrão de href
            links = [
                a for a in soup.find_all("a", href=True)
                if re.search(r"/imovel[is]?/[\w-]+", a["href"])
            ]

        if not links:
            print(f"    ✓ Nenhum anúncio na página {pagina}. Fim da listagem.")
            break

        novos = 0
        for link in links:
            href = link.get("href", "")
            if href.startswith("/"):
                href = BASE_URL + href
            elif not href.startswith("http"):
                href = urljoin(BASE_URL, href)

            slug = extrair_slug(href)
            if slug and slug not in slugs:
                slugs.append(slug)
                novos += 1

        print(f"    + {novos} novos slugs (total: {len(slugs)})")

        if novos == 0:
            break

        pagina += 1

    return slugs


def scrape_imovel(page, url: str) -> dict | None:
    """Extrai dados completos de um anúncio individual."""
    try:
        page.goto(url, timeout=PAGE_TIMEOUT, wait_until="networkidle")
        time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
    except PlaywrightTimeout:
        print(f"    ⚠ Timeout: {url}")
        return None

    soup = BeautifulSoup(page.content(), "lxml")

    def txt(selector: str) -> str:
        el = soup.select_one(selector)
        return el.get_text(strip=True) if el else ""

    # ── Título ─────────────────────────────────────────────────────────────────
    titulo = ""
    for sel in ["h1.property-title", "h1.titulo", "h1", ".titulo-imovel", ".property-title"]:
        titulo = txt(sel)
        if titulo:
            break

    if not titulo:
        return None

    # ── Tipo e Bairro ──────────────────────────────────────────────────────────
    tipo = ""
    for sel in [".property-type", ".tipo-imovel", "[class*='tipo']", ".breadcrumb li:nth-child(2)"]:
        tipo = txt(sel)
        if tipo:
            break

    bairro = ""
    for sel in [".property-location", ".bairro", "[class*='bairro']", ".location", ".endereco"]:
        bairro = txt(sel)
        if bairro:
            break

    # ── Preço ──────────────────────────────────────────────────────────────────
    preco = None
    for sel in [".property-price", ".preco", "[class*='preco']", ".valor", ".price"]:
        raw = txt(sel)
        if raw:
            preco = extrair_preco(raw)
            if preco:
                break

    # ── Área ───────────────────────────────────────────────────────────────────
    area_m2 = None
    for sel in [".property-area", ".area", "[class*='area']", "[class*='m2']"]:
        raw = txt(sel)
        if raw and "m" in raw.lower():
            area_m2 = extrair_area(raw)
            if area_m2:
                break

    # ── Características numéricas ──────────────────────────────────────────────
    quartos = suites = banheiros = garagem = andar = None

    # Tenta extrair de ícones/badges comuns
    specs = {}
    for item in soup.select(".property-features li, .features li, .specs li, .caracteristicas li"):
        text = item.get_text(strip=True).lower()
        val = extrair_numero(text)
        if val is None:
            continue
        if any(k in text for k in ["quarto", "dormitório", "dorm"]):
            specs["quartos"] = int(val)
        elif "suíte" in text or "suite" in text:
            specs["suites"] = int(val)
        elif "banheiro" in text or "wc" in text:
            specs["banheiros"] = int(val)
        elif "vaga" in text or "garagem" in text or "estacionamento" in text:
            specs["garagem"] = int(val)
        elif "andar" in text:
            specs["andar"] = int(val)

    quartos = specs.get("quartos")
    suites = specs.get("suites")
    banheiros = specs.get("banheiros")
    garagem = specs.get("garagem")
    andar = specs.get("andar")

    # ── Flags ──────────────────────────────────────────────────────────────────
    descricao = ""
    for sel in [".property-description", ".descricao", "[class*='descricao']", ".description"]:
        descricao = txt(sel)
        if descricao:
            break

    desc_lower = (titulo + " " + descricao).lower()
    eh_terreo = andar == 0 or "térreo" in desc_lower or "terreo" in desc_lower
    eh_cobertura = "cobertura" in desc_lower
    novo = any(k in desc_lower for k in ["lançamento", "novo", "nunca habitado", "obra"])
    reformado = any(k in desc_lower for k in ["reformado", "renovado", "recém reformado"])

    # ── Fotos ──────────────────────────────────────────────────────────────────
    fotos = []
    for img in soup.select(".property-gallery img, .galeria img, .slider img, [class*='gallery'] img"):
        src = img.get("src") or img.get("data-src") or img.get("data-lazy")
        if src:
            if src.startswith("/"):
                src = BASE_URL + src
            fotos.append(src)

    # ── Extração semântica ─────────────────────────────────────────────────────
    caracteristicas = extrair_caracteristicas(descricao)
    pois = extrair_pois(descricao)

    # ── Data de modificação ────────────────────────────────────────────────────
    ultima_modificacao = None
    for sel in [".property-date", ".data-atualizacao", "[class*='data']", "time"]:
        raw = txt(sel)
        if raw:
            match = re.search(r"(\d{2})/(\d{2})/(\d{4})", raw)
            if match:
                d, m, a = match.groups()
                ultima_modificacao = f"{a}-{m}-{d}"
                break

    return {
        "url": url,
        "slug": extrair_slug(url),
        "titulo": titulo,
        "tipo": tipo or None,
        "bairro": bairro or None,
        "preco": preco,
        "area_m2": area_m2,
        "quartos": quartos,
        "suites": suites,
        "banheiros": banheiros,
        "garagem": garagem,
        "andar": andar,
        "eh_terreo": eh_terreo,
        "eh_cobertura": eh_cobertura,
        "novo": novo,
        "reformado": reformado,
        "descricao": descricao or None,
        "caracteristicas": caracteristicas or None,
        "pois": pois or None,
        "fotos": fotos or None,
        "ultima_modificacao": ultima_modificacao,
        "status": "ativo",
        "scraped_at": datetime.utcnow().isoformat(),
    }


# ── Upsert no Supabase ─────────────────────────────────────────────────────────
def upsert_imovel(supabase: Client, dados: dict) -> str:
    """Faz upsert de um imóvel. Retorna 'inserido' ou 'atualizado'."""
    # Verifica se já existe
    res = supabase.table("imoveis").select("id").eq("url", dados["url"]).execute()
    existe = len(res.data) > 0

    if existe:
        supabase.table("imoveis").update(dados).eq("url", dados["url"]).execute()
        return "atualizado"
    else:
        supabase.table("imoveis").insert(dados).execute()
        return "inserido"


def marcar_inativos(supabase: Client, slugs_ativos: list[str]) -> int:
    """Marca como inativo imóveis não encontrados no scraping atual."""
    if not slugs_ativos:
        return 0

    res = (
        supabase.table("imoveis")
        .update({"status": "inativo"})
        .eq("status", "ativo")
        .not_.in_("slug", slugs_ativos)
        .execute()
    )
    return len(res.data) if res.data else 0


def salvar_log(supabase: Client, log: dict):
    """Salva log de execução na tabela scraping_logs."""
    supabase.table("scraping_logs").insert(log).execute()


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Scraper de imóveis — Lopes de Andrade")
    parser.add_argument("--test", type=int, metavar="N", help="Testa com N imóveis apenas")
    args = parser.parse_args()

    supabase = get_supabase()
    inicio = datetime.utcnow()

    contadores = {"total": 0, "inseridos": 0, "atualizados": 0, "inativos": 0, "erros": 0}
    erros_log = []

    print("=" * 60)
    print("  Radar Lopes — Scraper")
    print(f"  Iniciado: {inicio.strftime('%d/%m/%Y %H:%M:%S')}")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        # 1. Listar slugs
        print("\n[1/3] Coletando lista de anúncios...")
        try:
            slugs = listar_slugs(page)
        except Exception as e:
            print(f"  ✗ Erro fatal na listagem: {e}")
            browser.close()
            return

        if args.test:
            slugs = slugs[: args.test]
            print(f"  ▶ Modo teste: limitado a {args.test} imóveis")

        print(f"  ✓ {len(slugs)} anúncios encontrados\n")

        # 2. Scraping individual
        print("[2/3] Extraindo dados individuais...")
        for i, slug in enumerate(slugs, 1):
            url = f"{BASE_URL}/imovel/{slug}"
            print(f"  [{i:>4}/{len(slugs)}] {slug[:60]}")

            try:
                dados = scrape_imovel(page, url)
                if dados:
                    acao = upsert_imovel(supabase, dados)
                    contadores[acao + "s"] += 1
                    contadores["total"] += 1
                    print(f"           ✓ {acao}")
                else:
                    contadores["erros"] += 1
                    erros_log.append({"url": url, "erro": "dados nulos"})
                    print("           ✗ dados não extraídos")
            except Exception as e:
                contadores["erros"] += 1
                erros_log.append({"url": url, "erro": str(e)})
                print(f"           ✗ {e}")
                traceback.print_exc()

        browser.close()

    # 3. Marcar inativos
    if not args.test:
        print("\n[3/3] Verificando imóveis inativos...")
        contadores["inativos"] = marcar_inativos(supabase, slugs)
        print(f"  ✓ {contadores['inativos']} marcados como inativos")

    # 4. Salvar log
    fim = datetime.utcnow()
    salvar_log(supabase, {
        "iniciado_em": inicio.isoformat(),
        "finalizado_em": fim.isoformat(),
        "total": contadores["total"],
        "inseridos": contadores["inseridos"],
        "atualizados": contadores["atualizados"],
        "inativos": contadores["inativos"],
        "erros": contadores["erros"],
        "log_detalhado": {"erros": erros_log},
    })

    # 5. Relatório final
    duracao = (fim - inicio).seconds
    print("\n" + "=" * 60)
    print("  RELATÓRIO FINAL")
    print("=" * 60)
    print(f"  Total processado : {contadores['total']}")
    print(f"  Inseridos        : {contadores['inseridos']}")
    print(f"  Atualizados      : {contadores['atualizados']}")
    print(f"  Inativos         : {contadores['inativos']}")
    print(f"  Erros            : {contadores['erros']}")
    print(f"  Duração          : {duracao // 60}m {duracao % 60}s")
    print("=" * 60)


if __name__ == "__main__":
    main()
