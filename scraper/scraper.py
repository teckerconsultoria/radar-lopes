#!/usr/bin/env python3
"""
Radar Lopes — Scraper de Imóveis
Extrai anúncios do site lopesdeandrade.com.br e salva no Supabase.

Fases de execução:
  Fase 1 — Playwright  (~1-2min): nonce + AJAX — coleta lista de cards
  Fase 2 — httpx async (~1-3min): visita páginas individuais em paralelo (sem LLM)
  Fase 3 — Batch API   (~2-5min): extração semântica em lote + upsert Supabase

Uso:
    python scraper.py           # scraping completo
    python scraper.py --test 5  # testa com 5 imóveis
"""

import re
import sys
import time
import json
import random
import asyncio
import logging
import argparse
import traceback
from pathlib import Path
from datetime import datetime, date
from urllib.parse import urljoin, urlparse, quote

from dotenv import load_dotenv
import os

import httpx
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from bs4 import BeautifulSoup
from supabase import create_client, Client
import anthropic

load_dotenv(override=True)

# ── Logger ───────────────────────────────────────────────────────────────────
log = logging.getLogger("scraper")


def setup_debug_log():
    """Configura handler de arquivo para debug detalhado."""
    log_path = Path(__file__).parent / "debug.log"
    log.setLevel(logging.DEBUG)

    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    log.addHandler(fh)
    return log_path


# ── Configurações ──────────────────────────────────────────────────────────────
BASE_URL     = "https://lopesdeandrade.com.br"
PAGE_TIMEOUT = 30_000  # ms (Playwright)

HTTPX_CONCURRENCY = 10    # páginas simultâneas na Fase 2
HTTPX_TIMEOUT     = 20.0  # segundos por request
HTTPX_HEADERS     = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9",
}

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_KEY  = os.environ.get("ANTHROPIC_API_KEY", "")
LLM_MODEL      = "claude-haiku-4-5-20251001"
LLM_MAX_TOKENS = 512
LLM_FALLBACK   = {
    "suites":       None,
    "banheiros":    None,
    "garagem":      None,
    "andar":        None,
    "eh_terreo":    False,
    "eh_cobertura": False,
    "novo":         False,
    "reformado":    False,
    "caracteristicas": [],
    "pois":         [],
}

# Prompt de sistema — constante global usada em extrair_campos_llm e batch
SYSTEM_PROMPT = (
    "Você é um extrator de dados de anúncios imobiliários brasileiros.\n"
    "Analise o título e descrição fornecidos e retorne SOMENTE um objeto JSON válido,\n"
    "sem texto adicional, markdown ou explicações.\n\n"
    "Regras:\n"
    "- Use null para campos não mencionados ou incertos\n"
    "- Converta numerais por extenso para inteiros (uma=1, dois=2, três=3...)\n"
    "- 'primeiro andar' = andar 1, 'segundo andar' = andar 2, 'térreo' = andar 0\n"
    "- 'suíte' sem número = 1 suíte\n"
    "- 'vaga' sem número = 1 vaga\n"
    "- 'banheiro' sem número = 1 banheiro\n"
    "- caracteristicas: lista de atributos físicos do imóvel (piscina, varanda, "
    "churrasqueira, elevador, reformado, etc.) — máximo 15 itens, lowercase\n"
    "- pois: pontos de interesse mencionados (shopping, praia, escola, hospital, "
    "universidade, avenida, distâncias) — máximo 10 itens, lowercase"
)

# Categorias do site + seus term IDs (WP taxonomy: job_listing_category)
CATEGORIES = {
    "apartamento": "2",
    "casa":        "3",
    "sala":        "5",
    "cobertura":   "119",
    "terreno":     "30",
    "escritorio":  "4",
    "granja":      "120",
}

TIPO_MAP = {
    "apartamento": "Apartamento",
    "casa":        "Casa",
    "sala":        "Sala Comercial",
    "cobertura":   "Cobertura",
    "terreno":     "Terreno",
    "escritorio":  "Escritório",
    "granja":      "Granja",
}

LISTING_TYPES = ["for-sale", "for-rent"]


# ── Supabase ──────────────────────────────────────────────────────────────────
def get_supabase() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ── Extração de texto ─────────────────────────────────────────────────────────
def extrair_numero(texto: str) -> float | None:
    if not texto:
        return None
    clean = re.sub(r"[^\d,.]", "", texto).replace(".", "").replace(",", ".")
    match = re.search(r"[\d.]+", clean)
    if match:
        try:
            return float(match.group())
        except ValueError:
            return None
    return None


def extrair_preco(texto: str) -> float | None:
    if not texto:
        return None
    clean = re.sub(r"[ValorR$\s]", "", texto, flags=re.IGNORECASE)
    clean = clean.replace(".", "").replace(",", ".")
    match = re.search(r"[\d.]+", clean)
    if match:
        try:
            val = float(match.group())
            return val if val > 0 else None
        except ValueError:
            return None
    return None


def extrair_area(texto: str) -> float | None:
    if not texto:
        return None
    match = re.search(r"([\d.,]+)\s*m[²2]?", texto.replace(",", "."), re.IGNORECASE)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


def extrair_slug(url: str) -> str:
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    return parts[-1] if parts else url


# ── Helpers LLM ───────────────────────────────────────────────────────────────
def montar_user_prompt(inp: dict) -> str:
    """Monta o user prompt a partir de um dict _llm_input."""
    return (
        f"Título: {inp['titulo']}\n"
        f"Descrição: {inp['descricao']}\n\n"
        f"Hints (dados já confirmados via HTML):\n"
        f"- tem_suite: {inp['tem_suite']}\n"
        f"- tem_garagem: {inp['tem_garagem']}\n\n"
        'Retorne JSON com exatamente estas chaves:\n'
        '{"suites": <int|null>, "banheiros": <int|null>, "garagem": <int|null>, '
        '"andar": <int|null>, "eh_terreo": <bool>, "eh_cobertura": <bool>, '
        '"novo": <bool>, "reformado": <bool>, '
        '"caracteristicas": [<str>, ...], "pois": [<str>, ...]}'
    )


def parsear_resposta_llm(raw: str) -> dict:
    """Parseia JSON bruto retornado pelo LLM. Lança exceção em caso de falha."""
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw).strip()

    resultado = json.loads(raw)

    def to_int(v):
        try:
            return int(v) if v is not None else None
        except (ValueError, TypeError):
            return None

    return {
        "suites":          to_int(resultado.get("suites")),
        "banheiros":       to_int(resultado.get("banheiros")),
        "garagem":         to_int(resultado.get("garagem")),
        "andar":           to_int(resultado.get("andar")),
        "eh_terreo":       bool(resultado.get("eh_terreo", False)),
        "eh_cobertura":    bool(resultado.get("eh_cobertura", False)),
        "novo":            bool(resultado.get("novo", False)),
        "reformado":       bool(resultado.get("reformado", False)),
        "caracteristicas": [str(c).lower() for c in resultado.get("caracteristicas", []) if c],
        "pois":            [str(p).lower() for p in resultado.get("pois", []) if p],
    }


def extrair_campos_llm(
    descricao: str,
    titulo: str,
    tem_suite: bool = False,
    tem_garagem: bool = False,
    debug: bool = False,
) -> dict:
    """
    Usa o claude-haiku para extrair campos semânticos da descrição do anúncio.
    Retorna LLM_FALLBACK em caso de erro — nunca propaga exceção.
    Mantido para compatibilidade/uso standalone.
    """
    if not descricao and not titulo:
        return LLM_FALLBACK.copy()

    inp = {
        "titulo": titulo,
        "descricao": descricao,
        "tem_suite": tem_suite,
        "tem_garagem": tem_garagem,
    }
    user_prompt = montar_user_prompt(inp)

    if debug:
        log.debug(f"[LLM] prompt enviado:\n{user_prompt}")

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
        message = client.messages.create(
            model=LLM_MODEL,
            max_tokens=LLM_MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = message.content[0].text.strip()
        if debug:
            log.debug(f"[LLM] resposta bruta: {raw}")

        return parsear_resposta_llm(raw)

    except (anthropic.APIError, json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
        log.warning(f"[LLM] falha na extração: {e} — usando fallback")
        return LLM_FALLBACK.copy()


# ── Extração de dados do card ─────────────────────────────────────────────────
def extrair_dados_card(card_el, categoria: str) -> dict:
    """
    Extrai dados do card da listagem via CSS classes do tema My Listing.
    """
    classes = card_el.get("class", [])
    classes_str = " ".join(classes)

    bairro = None
    region_match = re.search(r"\bregion-([\w-]+)", classes_str)
    if region_match:
        bairro = region_match.group(1).replace("-", " ").title()

    tags = re.findall(r"case27_job_listing_tags-([\w-]+)", classes_str)

    quartos = None
    for tag in tags:
        m = re.match(r"^(\d+)-quartos?$", tag)
        if m:
            quartos = int(m.group(1))
            break

    tem_suite   = any(re.match(r"^suite[s-]", tag) for tag in tags)
    tem_garagem = "garagem" in tags

    carac_ignorar = {"garagem"}
    carac_ignorar.update({t for t in tags if re.match(r"^\d+-quartos?$", t)})
    carac_ignorar.update({t for t in tags if re.match(r"^suite[s-]", t)})
    caracteristicas_card = [t.replace("-", " ") for t in tags if t not in carac_ignorar]

    tipo = TIPO_MAP.get(categoria)

    url = None
    link = card_el.select_one("a[href*='/imovel/']")
    if link:
        href = link.get("href", "")
        url = BASE_URL + href if href.startswith("/") else href

    return {
        "url": url,
        "tipo": tipo,
        "bairro": bairro,
        "quartos": quartos,
        "tem_suite": tem_suite,
        "garagem": 1 if tem_garagem else None,
        "caracteristicas_card": caracteristicas_card,
    }


# ── FASE 1A: nonce (Playwright) ───────────────────────────────────────────────
def obter_security(page) -> str | None:
    """Carrega uma categoria e intercepta o nonce do AJAX."""
    security_found = []

    def on_req(req):
        m = re.search(r"security=([a-f0-9]+)", req.url)
        if m:
            security_found.append(m.group(1))

    page.on("request", on_req)
    try:
        page.goto(f"{BASE_URL}/category/apartamento/", timeout=PAGE_TIMEOUT, wait_until="networkidle")
        time.sleep(1)
    except PlaywrightTimeout:
        pass
    page.remove_listener("request", on_req)

    return security_found[0] if security_found else None


# ── FASE 1B: AJAX paginado (Playwright) ───────────────────────────────────────
def coletar_via_ajax(page, security: str, debug: bool = False) -> list[dict]:
    """
    Usa a API AJAX do tema My Listing para coletar todos os imóveis.
    Retorna lista de dicts com url, tipo, bairro, quartos, suites, garagem, caracteristicas_card.
    """
    todos = {}

    for categoria, term_id in CATEGORIES.items():
        for listing_type in LISTING_TYPES:
            pg = 0
            while True:
                ajax_url = (
                    f"{BASE_URL}/?mylisting-ajax=1&action=get_listings"
                    f"&security={security}"
                    f"&form_data%5Bcontext%5D=term-search"
                    f"&form_data%5Btaxonomy%5D=job_listing_category"
                    f"&form_data%5Bterm%5D={term_id}"
                    f"&form_data%5Bpage%5D={pg}"
                    f"&form_data%5Bsort%5D=latest"
                    f"&listing_type={listing_type}"
                    f"&listing_wrap=col-md-12+grid-item"
                )
                try:
                    page.goto(ajax_url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
                    raw_text = page.evaluate("document.body.innerText")
                    data = json.loads(raw_text)
                except Exception as e:
                    print(f"    ⚠ AJAX erro ({categoria}/{listing_type} p{pg}): {e}")
                    log.error(f"AJAX erro [{categoria}/{listing_type} p{pg}]: {e}")
                    break

                found     = data.get("found_posts", 0)
                max_pages = data.get("max_num_pages", 1) or 1
                html_content = data.get("html", "")

                if debug:
                    log.debug(
                        f"AJAX [{categoria}/{listing_type} p{pg}] "
                        f"found={found} max_pages={max_pages} "
                        f"html_len={len(html_content)}"
                    )
                    data_sem_html = {k: v for k, v in data.items() if k != "html"}
                    log.debug(f"  JSON (sem html): {json.dumps(data_sem_html, ensure_ascii=False)}")

                if found == 0:
                    if debug:
                        log.debug(f"  Nenhum imóvel em {categoria}/{listing_type} p{pg} — encerrando loop")
                    break

                if pg == 0:
                    print(f"  {categoria}/{listing_type}: {found} imóveis, {max_pages} páginas")

                soup = BeautifulSoup(html_content, "lxml")
                cards = soup.select(".lf-item-container.listing-preview")

                if debug:
                    log.debug(f"  Cards encontrados no HTML: {len(cards)}")

                for card in cards:
                    dados = extrair_dados_card(card, categoria)

                    if debug:
                        classes_str = " ".join(card.get("class", []))
                        log.debug(
                            f"  CARD url={dados['url']} "
                            f"bairro={dados['bairro']} quartos={dados['quartos']} "
                            f"tem_suite={dados['tem_suite']} garagem={dados['garagem']} "
                            f"tags={dados['caracteristicas_card']}"
                        )
                        log.debug(f"    classes_css={classes_str[:300]}")

                    if dados["url"] and dados["url"] not in todos:
                        todos[dados["url"]] = dados

                if pg >= max_pages - 1:
                    break
                pg += 1
                time.sleep(random.uniform(0.3, 0.7))

    return list(todos.values())


# ── FASE 2: scraping individual via httpx (async) ─────────────────────────────
def _parse_imovel_html(html: str, url: str, dados_card: dict, idx: int, debug: bool = False) -> dict | None:
    """
    Parseia o HTML de uma página de imóvel com BeautifulSoup.
    Retorna dict com dados HTML + _llm_input (sem chamar LLM).
    """
    soup = BeautifulSoup(html, "lxml")

    def txt(selector: str) -> str:
        el = soup.select_one(selector)
        return el.get_text(strip=True) if el else ""

    if debug:
        log.debug(f"[PARSE] {url} — HTML len={len(html)}")

    titulo = txt("h1") or txt(".listing-title") or txt(".entry-title")
    if not titulo:
        log.warning(f"Título não encontrado em: {url}")
        return None

    preco = None
    raw_price = txt(".price-or-date")
    if raw_price:
        preco = extrair_preco(raw_price)

    descricao = ""
    for sel in [
        ".block-field-job_description",
        "[class*='job_description']",
        ".listing-description",
        ".description",
    ]:
        descricao = txt(sel)
        if descricao:
            descricao = re.sub(r"^Descri[çc][aã]o\s*", "", descricao, flags=re.IGNORECASE).strip()
            break

    area_m2 = None
    for li in soup.select("ul.extra-details li"):
        label = li.select_one(".item-attr")
        value = li.select_one(".item-property")
        if label and value and "área" in label.get_text(strip=True).lower():
            area_m2 = extrair_area(value.get_text(strip=True))
            break
    if area_m2 is None and descricao:
        area_m2 = extrair_area(descricao)

    quartos = dados_card.get("quartos")

    # Quartos: fallback via tabela extra-details da página
    if quartos is None:
        for li in soup.select("ul.extra-details li"):
            label = li.select_one(".item-attr")
            value = li.select_one(".item-property")
            if label and value and "quarto" in label.get_text(strip=True).lower():
                raw_q = value.get_text(strip=True)
                m_q = re.search(r"\d+", raw_q)
                if m_q:
                    quartos = int(m_q.group())
                if debug:
                    log.debug(f"  quartos raw (extra-details)='{raw_q}' → quartos={quartos}")
                break

    # Quartos: fallback pela descrição
    if quartos is None and descricao:
        m = re.search(r"(\d+)\s*quartos?", descricao, re.IGNORECASE)
        if m:
            quartos = int(m.group(1))

    endereco  = None
    cep       = None
    latitude  = None
    longitude = None

    addr_el = soup.select_one(".map-block-address p")
    if addr_el:
        endereco = addr_el.get_text(strip=True)
        cep_match = re.search(r"\b(\d{5})(?:-?\d{3})?\b", endereco)
        if cep_match:
            cep = cep_match.group(0).replace("-", "")

    map_el = soup.select_one(".c27-map[data-options]")
    if map_el:
        try:
            map_opts  = json.loads(map_el["data-options"])
            locations = map_opts.get("locations", [])
            if locations:
                latitude  = float(locations[0].get("marker_lat", 0)) or None
                longitude = float(locations[0].get("marker_lng", 0)) or None
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            log.warning(f"  Erro lat/lng em {url}: {e}")

    bairro = dados_card.get("bairro")
    if not bairro:
        for sel in [".listing-location", ".location", "[class*='location']"]:
            raw = txt(sel)
            if raw:
                bairro = raw.split(",")[0].strip()
                break
    # 3º fallback: extrair bairro do slug da URL
    if not bairro:
        slug = extrair_slug(url)
        m_bairro = re.search(
            r'(?:na-regiao-(?:do|da)|na-praia-de|no-bairro-(?:das?|dos?)|(?:no|na|em|nos|nas))'
            r'-([a-z][a-z0-9]*(?:-[a-z0-9]+){0,4})(?:-\d+)?$',
            slug
        )
        if m_bairro:
            bairro = m_bairro.group(1).replace('-', ' ').title()
            if debug:
                log.debug(f"  bairro extraído do slug: '{bairro}'")

    fotos = []
    for img in soup.select(
        ".block-field-job_gallery img, "
        "[class*='gallery'] img, "
        ".slider img, "
        ".cover-photo img"
    ):
        src = img.get("src") or img.get("data-src") or img.get("data-lazy")
        if src:
            if src.startswith("/"):
                src = BASE_URL + src
            fotos.append(src)

    ultima_modificacao = None
    for sel in [".listing-date", "[class*='date']", "time[datetime]"]:
        el = soup.select_one(sel)
        if el:
            raw = el.get("datetime") or el.get_text(strip=True)
            m_date = re.search(r"(\d{2})/(\d{2})/(\d{4})", raw)
            if m_date:
                d, mo, a = m_date.groups()
                ultima_modificacao = f"{a}-{mo.zfill(2)}-{d.zfill(2)}"
                break

    return {
        # campos HTML
        "url":                url,
        "slug":               extrair_slug(url),
        "titulo":             titulo,
        "tipo":               dados_card.get("tipo"),
        "bairro":             bairro or None,
        "preco":              preco,
        "area_m2":            area_m2,
        "quartos":            quartos,
        "garagem_card":       dados_card.get("garagem"),
        "caracteristicas_card": dados_card.get("caracteristicas_card", []),
        "fotos":              fotos or None,
        "ultima_modificacao": ultima_modificacao,
        "endereco":           endereco,
        "cep":                cep,
        "latitude":           latitude,
        "longitude":          longitude,
        "status":             "ativo",
        "scraped_at":         datetime.utcnow().isoformat(),
        # input para o LLM
        "_llm_input": {
            "custom_id":  f"imovel-{idx}",
            "descricao":  descricao or "",
            "titulo":     titulo or "",
            "tem_suite":  dados_card.get("tem_suite", False),
            "tem_garagem": bool(dados_card.get("garagem")),
        },
    }


async def _scrape_imovel_async(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    dados_card: dict,
    idx: int,
    total: int,
    debug: bool = False,
) -> dict | None:
    url = dados_card["url"]
    slug = extrair_slug(url)

    async with sem:
        try:
            resp = await client.get(url, timeout=HTTPX_TIMEOUT)
            resp.raise_for_status()
        except Exception as e:
            print(f"  [{idx:>4}/{total}] {slug[:50]} | ✗ {e}")
            log.warning(f"httpx erro em {url}: {e}")
            return None

    resultado = _parse_imovel_html(resp.text, url, dados_card, idx, debug)
    if resultado:
        bairro = resultado.get("bairro") or "?"
        print(f"  [{idx:>4}/{total}] {slug[:50]} | ✓ HTML | {bairro}")
        log.info(f"HTML coletado: {url}")
    else:
        print(f"  [{idx:>4}/{total}] {slug[:50]} | ✗ parse falhou")

    return resultado


async def coletar_html_async(todos_cards: list[dict], debug: bool = False) -> list[dict]:
    """Visita todas as páginas individuais em paralelo via httpx."""
    sem = asyncio.Semaphore(HTTPX_CONCURRENCY)
    async with httpx.AsyncClient(
        headers=HTTPX_HEADERS,
        follow_redirects=True,
        timeout=HTTPX_TIMEOUT,
    ) as client:
        tasks = [
            _scrape_imovel_async(client, sem, card, i, len(todos_cards), debug)
            for i, card in enumerate(todos_cards, 1)
        ]
        resultados = await asyncio.gather(*tasks)

    return [r for r in resultados if r]


# ── FASE 3A: Batch API ────────────────────────────────────────────────────────
def executar_batch_llm(todos_html: list[dict]) -> dict[str, dict]:
    """
    Envia todos os _llm_input para a Batch API do Anthropic.
    Retorna dict: custom_id → campos_llm.
    """
    llm_inputs = [item["_llm_input"] for item in todos_html]

    if not llm_inputs:
        return {}

    anth = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    batch_requests = [
        {
            "custom_id": inp["custom_id"],
            "params": {
                "model":      LLM_MODEL,
                "max_tokens": LLM_MAX_TOKENS,
                "system":     SYSTEM_PROMPT,
                "messages":   [{"role": "user", "content": montar_user_prompt(inp)}],
            },
        }
        for inp in llm_inputs
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

    print(f"  ✓ Batch concluído — {batch.request_counts.succeeded} sucessos")
    log.info(f"Batch {batch.id} concluído: {batch.request_counts}")

    resultados = {}
    for result in anth.messages.batches.results(batch.id):
        cid = result.custom_id
        try:
            raw = result.result.message.content[0].text.strip()
            resultados[cid] = parsear_resposta_llm(raw)
        except Exception as e:
            log.warning(f"[Batch] falha em {cid}: {e} — usando fallback")
            resultados[cid] = LLM_FALLBACK.copy()

    return resultados


# ── FASE 3B: merge + upsert ───────────────────────────────────────────────────
def montar_dados_completos(html_data: dict, campos_llm: dict) -> dict:
    """Mescla dados HTML com campos extraídos pelo LLM."""
    garagem = html_data["garagem_card"] or campos_llm["garagem"]

    carac_card = html_data.get("caracteristicas_card", [])
    caracteristicas = list(dict.fromkeys(carac_card + campos_llm["caracteristicas"])) or None

    pois = campos_llm["pois"] or None

    return {
        "url":                html_data["url"],
        "slug":               html_data["slug"],
        "titulo":             html_data["titulo"],
        "tipo":               html_data["tipo"],
        "bairro":             html_data["bairro"],
        "preco":              html_data["preco"],
        "area_m2":            html_data["area_m2"],
        "quartos":            html_data["quartos"],
        "suites":             campos_llm["suites"],
        "banheiros":          campos_llm["banheiros"],
        "garagem":            garagem,
        "andar":              campos_llm["andar"],
        "eh_terreo":          campos_llm["eh_terreo"],
        "eh_cobertura":       campos_llm["eh_cobertura"],
        "novo":               campos_llm["novo"],
        "reformado":          campos_llm["reformado"],
        "descricao":          html_data["_llm_input"]["descricao"] or None,
        "caracteristicas":    caracteristicas,
        "pois":               pois,
        "fotos":              html_data["fotos"],
        "ultima_modificacao": html_data["ultima_modificacao"],
        "endereco":           html_data["endereco"],
        "cep":                html_data["cep"],
        "latitude":           html_data["latitude"],
        "longitude":          html_data["longitude"],
        "status":             html_data["status"],
        "scraped_at":         html_data["scraped_at"],
    }


# ── Supabase helpers ──────────────────────────────────────────────────────────
def upsert_imovel(supabase: Client, dados: dict) -> str:
    res = supabase.table("imoveis").select("id").eq("url", dados["url"]).execute()
    if res.data:
        supabase.table("imoveis").update(dados).eq("url", dados["url"]).execute()
        return "atualizado"
    else:
        supabase.table("imoveis").insert(dados).execute()
        return "inserido"


def marcar_inativos(supabase: Client, slugs_ativos: list[str]) -> int:
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


def salvar_log(supabase: Client, dados: dict):
    supabase.table("scraping_logs").insert(dados).execute()


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Scraper — Lopes de Andrade")
    parser.add_argument("--test",  type=int, metavar="N", help="Testa com N imóveis apenas")
    parser.add_argument("--debug", action="store_true",   help="Grava log detalhado em debug.log")
    args = parser.parse_args()

    if args.debug:
        log_path = setup_debug_log()
        log.info("=" * 60)
        log.info("Sessão de debug iniciada")
        log.info("=" * 60)
        print(f"  [DEBUG] Log gravando em: {log_path}")

    supabase = get_supabase()
    inicio   = datetime.utcnow()
    contadores = {"total": 0, "inseridos": 0, "atualizados": 0, "inativos": 0, "erros": 0}
    erros_log  = []

    print("=" * 60)
    print("  Radar Lopes — Scraper")
    print(f"  Iniciado: {inicio.strftime('%d/%m/%Y %H:%M:%S')}")
    print("=" * 60)

    # ── FASE 1: Playwright — nonce + AJAX ─────────────────────────────────────
    print("\n[FASE 1/3] Playwright — coletando lista via AJAX...")
    t1 = time.time()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=HTTPX_HEADERS["User-Agent"],
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        print("  Obtendo token de segurança...")
        security = obter_security(page)
        if not security:
            print("  ✗ Não foi possível obter o nonce. Abortando.")
            log.error("Nonce não encontrado — abortando")
            browser.close()
            return
        print(f"  ✓ security={security}")
        log.info(f"Nonce obtido: {security}")

        print("  Coletando anúncios...")
        todos_cards = coletar_via_ajax(page, security, debug=args.debug)
        browser.close()

    print(f"  ✓ {len(todos_cards)} anúncios encontrados ({time.time()-t1:.0f}s)")
    log.info(f"Fase 1 concluída: {len(todos_cards)} cards em {time.time()-t1:.0f}s")

    if args.test:
        todos_cards = todos_cards[: args.test]
        print(f"  ▶ Modo teste: limitado a {args.test} imóveis")

    # ── FASE 2: httpx async — HTML das páginas individuais ────────────────────
    print(f"\n[FASE 2/3] httpx — extraindo HTML de {len(todos_cards)} páginas...")
    t2 = time.time()

    todos_html = asyncio.run(coletar_html_async(todos_cards, debug=args.debug))

    erros_fase2 = len(todos_cards) - len(todos_html)
    print(f"  ✓ {len(todos_html)} páginas extraídas ({time.time()-t2:.0f}s) | {erros_fase2} erros")
    log.info(f"Fase 2 concluída: {len(todos_html)} HTML em {time.time()-t2:.0f}s")

    if not todos_html:
        print("  ✗ Nenhum dado coletado. Abortando.")
        return

    # ── FASE 3: Batch API + upsert ────────────────────────────────────────────
    print(f"\n[FASE 3/3] Batch API + Upsert Supabase...")
    t3 = time.time()

    batch_results = executar_batch_llm(todos_html)

    print(f"  Fazendo upsert de {len(todos_html)} imóveis...")
    slugs_ativos = []

    for item in todos_html:
        url   = item["url"]
        slug  = item["slug"]
        slugs_ativos.append(slug)

        cid        = item["_llm_input"]["custom_id"]
        campos_llm = batch_results.get(cid, LLM_FALLBACK.copy())
        dados      = montar_dados_completos(item, campos_llm)

        try:
            acao = upsert_imovel(supabase, dados)
            contadores[acao + "s"] += 1
            contadores["total"] += 1
            preco_str = f"R${dados['preco']:,.0f}" if dados.get("preco") else "s/preço"
            print(f"    ✓ {acao} | {slug[:45]} | {preco_str} | {dados.get('bairro','?')}")
        except Exception as e:
            contadores["erros"] += 1
            erros_log.append({"url": url, "erro": str(e)})
            print(f"    ✗ {slug[:45]} | {e}")
            log.error(f"Upsert erro em {url}: {e}")

    contadores["erros"] += erros_fase2

    print(f"  ✓ Upsert concluído ({time.time()-t3:.0f}s)")

    # ── Marca inativos ────────────────────────────────────────────────────────
    if not args.test:
        print("\nVerificando imóveis inativos...")
        contadores["inativos"] = marcar_inativos(supabase, slugs_ativos)
        print(f"  ✓ {contadores['inativos']} marcados como inativos")

    # ── Salva log ─────────────────────────────────────────────────────────────
    fim = datetime.utcnow()
    salvar_log(supabase, {
        "iniciado_em":   inicio.isoformat(),
        "finalizado_em": fim.isoformat(),
        "total":         contadores["total"],
        "inseridos":     contadores["inseridos"],
        "atualizados":   contadores["atualizados"],
        "inativos":      contadores["inativos"],
        "erros":         contadores["erros"],
        "log_detalhado": {"erros": erros_log},
    })

    # ── Relatório ─────────────────────────────────────────────────────────────
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
