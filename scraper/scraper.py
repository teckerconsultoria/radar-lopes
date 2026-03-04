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
import json
import random
import logging
import argparse
import traceback
from pathlib import Path
from datetime import datetime, date
from urllib.parse import urljoin, urlparse, quote

from dotenv import load_dotenv
import os

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
DELAY_MIN    = 1.2
DELAY_MAX    = 2.5
PAGE_TIMEOUT = 30_000  # ms

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

# Categorias do site + seus term IDs (WP taxonomy: job_listing_category)
# Obtidos por inspeção das chamadas AJAX do tema My Listing
CATEGORIES = {
    "apartamento": "2",
    "casa":        "3",
    "sala":        "5",
    "cobertura":   "119",
    "terreno":     "30",
    "escritorio":  "4",
    "granja":      "120",
}

# Mapeamento de categoria para tipo canônico no banco
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
    # Remove "Valor", "R$", espaços; normaliza separadores BR
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



# ── Extração semântica via LLM ────────────────────────────────────────────────
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
    """
    if not descricao and not titulo:
        return LLM_FALLBACK.copy()

    system_prompt = (
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

    user_prompt = (
        f"Título: {titulo}\n"
        f"Descrição: {descricao}\n\n"
        f"Hints (dados já confirmados via HTML):\n"
        f"- tem_suite: {tem_suite}\n"
        f"- tem_garagem: {tem_garagem}\n\n"
        'Retorne JSON com exatamente estas chaves:\n'
        '{"suites": <int|null>, "banheiros": <int|null>, "garagem": <int|null>, '
        '"andar": <int|null>, "eh_terreo": <bool>, "eh_cobertura": <bool>, '
        '"novo": <bool>, "reformado": <bool>, '
        '"caracteristicas": [<str>, ...], "pois": [<str>, ...]}'
    )

    if debug:
        log.debug(f"[LLM] prompt enviado:\n{user_prompt}")

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
        message = client.messages.create(
            model=LLM_MODEL,
            max_tokens=LLM_MAX_TOKENS,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = message.content[0].text.strip()
        if debug:
            log.debug(f"[LLM] resposta bruta: {raw}")

        # Remove markdown code block se o modelo ignorar a instrução
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

    except (anthropic.APIError, json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
        log.warning(f"[LLM] falha na extração: {e} — usando fallback")
        return LLM_FALLBACK.copy()


def extrair_slug(url: str) -> str:
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    return parts[-1] if parts else url


# ── Extração de dados do card (CSS classes do tema My Listing) ────────────────
def extrair_dados_card(card_el, categoria: str) -> dict:
    """
    Extrai dados do card da listagem via CSS classes do tema My Listing.
    Classes relevantes:
      job_listing_category-{tipo}
      region-{bairro}
      case27_job_listing_tags-{tag}
    """
    classes = card_el.get("class", [])
    classes_str = " ".join(classes)

    # Bairro via region-*
    bairro = None
    region_match = re.search(r"\bregion-([\w-]+)", classes_str)
    if region_match:
        bairro = region_match.group(1).replace("-", " ").title()

    # Tags do imóvel
    tags = re.findall(r"case27_job_listing_tags-([\w-]+)", classes_str)

    # Quartos via tag "N-quartos"
    quartos = None
    for tag in tags:
        m = re.match(r"^(\d+)-quartos?$", tag)
        if m:
            quartos = int(m.group(1))
            break

    # Suítes: presença de qualquer tag suite-* indica que tem suíte
    # A quantidade exata será extraída da descrição da página individual
    tem_suite = any(re.match(r"^suite[s-]", tag) for tag in tags)

    # Garagem (boolean — tag "garagem")
    tem_garagem = "garagem" in tags

    # Características limpas (remove quartos/suítes/garagem que já extraímos)
    carac_ignorar = {"garagem"}
    carac_ignorar.update({t for t in tags if re.match(r"^\d+-quartos?$", t)})
    carac_ignorar.update({t for t in tags if re.match(r"^suite[s-]", t)})
    caracteristicas_card = [t.replace("-", " ") for t in tags if t not in carac_ignorar]

    # Tipo canônico
    tipo = TIPO_MAP.get(categoria)

    # URL do imóvel
    url = None
    link = card_el.select_one("a[href*='/imovel/']")
    if link:
        href = link.get("href", "")
        if href.startswith("/"):
            url = BASE_URL + href
        else:
            url = href

    return {
        "url": url,
        "tipo": tipo,
        "bairro": bairro,
        "quartos": quartos,
        "tem_suite": tem_suite,   # boolean: confirma presença, qty vem da página
        "garagem": 1 if tem_garagem else None,
        "caracteristicas_card": caracteristicas_card,
    }


# ── AJAX API: coleta slugs + dados básicos ────────────────────────────────────
def coletar_via_ajax(page, security: str, debug: bool = False) -> list[dict]:
    """
    Usa a API AJAX do tema My Listing para coletar todos os imóveis.
    Retorna lista de dicts com url, tipo, bairro, quartos, suites, garagem, caracteristicas_card.
    """
    todos = {}  # url → dados

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
                    # JSON bruto (sem o campo html para não poluir)
                    data_sem_html = {k: v for k, v in data.items() if k != "html"}
                    log.debug(f"  JSON (sem html): {json.dumps(data_sem_html, ensure_ascii=False)}")

                if found == 0:
                    if debug:
                        log.debug(f"  Nenhum imóvel em {categoria}/{listing_type} p{pg} — encerrando loop")
                    break

                if pg == 0:
                    print(f"  {categoria}/{listing_type}: {found} imóveis, {max_pages} páginas")

                # Parseia cards do HTML retornado
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
                time.sleep(random.uniform(0.5, 1.0))

    return list(todos.values())


# ── Extração do nonce (security token) ───────────────────────────────────────
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
        time.sleep(2)
    except PlaywrightTimeout:
        pass
    page.remove_listener("request", on_req)

    return security_found[0] if security_found else None


# ── Scraping da página individual ─────────────────────────────────────────────
def scrape_imovel(page, url: str, dados_card: dict, debug: bool = False) -> dict | None:
    """
    Visita a página individual do imóvel e extrai dados completos.
    Mescla com dados já extraídos do card (tipo, bairro, quartos, etc.)
    """
    log.info(f"Scraping: {url}")
    try:
        page.goto(url, timeout=PAGE_TIMEOUT, wait_until="networkidle")
        time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))
    except PlaywrightTimeout:
        print(f"    ⚠ Timeout: {url}")
        log.warning(f"Timeout ao carregar: {url}")
        return None

    soup = BeautifulSoup(page.content(), "lxml")

    def txt(selector: str) -> str:
        el = soup.select_one(selector)
        return el.get_text(strip=True) if el else ""

    # ── Título ─────────────────────────────────────────────────────────────────
    if debug:
        html_body = page.content()
        log.debug(f"HTML body (primeiros 3000 chars):\n{html_body[:3000]}")

    titulo = txt("h1") or txt(".listing-title") or txt(".entry-title")
    if not titulo:
        log.warning(f"Título não encontrado em: {url}")
        return None

    # ── Preço (.price-or-date contém "ValorR$1.900,00") ───────────────────────
    preco = None
    raw_price = txt(".price-or-date")
    if debug:
        log.debug(f"  raw_price='{raw_price}'")
    if raw_price:
        preco = extrair_preco(raw_price)
        if debug:
            log.debug(f"  preco extraido={preco}")

    # ── Descrição ──────────────────────────────────────────────────────────────
    descricao = ""
    for sel in [
        ".block-field-job_description",
        "[class*='job_description']",
        ".listing-description",
        ".description",
    ]:
        descricao = txt(sel)
        if descricao:
            # Remove o rótulo "Descrição" que o tema inclui
            descricao = re.sub(r"^Descri[çc][aã]o\s*", "", descricao, flags=re.IGNORECASE).strip()
            break

    # ── Área — via tabela extra-details (item-attr = "Área") ──────────────────
    area_m2 = None
    for li in soup.select("ul.extra-details li"):
        label = li.select_one(".item-attr")
        value = li.select_one(".item-property")
        if label and value and "área" in label.get_text(strip=True).lower():
            raw_area = value.get_text(strip=True)
            area_m2 = extrair_area(raw_area)
            if debug:
                log.debug(f"  area raw (extra-details)='{raw_area}' → area_m2={area_m2}")
            break
    # Fallback: descrição
    if area_m2 is None and descricao:
        area_m2 = extrair_area(descricao)
        if debug and area_m2:
            log.debug(f"  area_m2={area_m2} (via descricao)")

    # ── LLM: extração semântica da descrição ──────────────────────────────────
    campos_llm = extrair_campos_llm(
        descricao=descricao or "",
        titulo=titulo or "",
        tem_suite=dados_card.get("tem_suite", False),
        tem_garagem=bool(dados_card.get("garagem")),
        debug=debug,
    )

    # ── Quartos/garagem ────────────────────────────────────────────────────────
    quartos = dados_card.get("quartos")
    # Quartos: fallback pela descrição (mantido em regex — campo com seletor CSS confiável)
    if quartos is None and descricao:
        m = re.search(r"(\d+)\s*quartos?", descricao, re.IGNORECASE)
        if m:
            quartos = int(m.group(1))

    # Garagem: card tem prioridade; LLM como fallback
    garagem = dados_card.get("garagem") or campos_llm["garagem"]

    # ── Endereço, CEP, Lat, Lng ──────────────────────────────────────────────────
    endereco = None
    cep      = None
    latitude = None
    longitude = None

    # Endereço completo via bloco de mapa
    addr_el = soup.select_one(".map-block-address p")
    if addr_el:
        endereco = addr_el.get_text(strip=True)
        if debug:
            log.debug(f"  endereco='{endereco}'")
        # CEP: 5 dígitos (poderia ter hífen + 3, mas o site usa só 5)
        cep_match = re.search(r"\b(\d{5})(?:-?\d{3})?\b", endereco)
        if cep_match:
            cep = cep_match.group(0).replace("-", "")
            if debug:
                log.debug(f"  cep='{cep}'")

    # Lat/Lng via data-options do mapa Mapbox
    map_el = soup.select_one(".c27-map[data-options]")
    if map_el:
        try:
            map_opts = json.loads(map_el["data-options"])
            locations = map_opts.get("locations", [])
            if locations:
                latitude  = float(locations[0].get("marker_lat", 0)) or None
                longitude = float(locations[0].get("marker_lng", 0)) or None
                if debug:
                    log.debug(f"  lat={latitude} lng={longitude}")
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            log.warning(f"  Erro ao extrair lat/lng: {e}")

    # ── Bairro (fallback se não veio do card) ──────────────────────────────────
    bairro = dados_card.get("bairro")
    if not bairro:
        for sel in [".listing-location", ".location", "[class*='location']"]:
            raw = txt(sel)
            if raw:
                bairro = raw.split(",")[0].strip()
                break

    # ── Campos semânticos vindos do LLM ───────────────────────────────────────
    suites       = campos_llm["suites"]
    banheiros    = campos_llm["banheiros"]
    andar        = campos_llm["andar"]
    eh_terreo    = campos_llm["eh_terreo"]
    eh_cobertura = campos_llm["eh_cobertura"]
    novo         = campos_llm["novo"]
    reformado    = campos_llm["reformado"]

    # Características: card + LLM (sem duplicatas, ordem estável)
    carac_card = dados_card.get("caracteristicas_card", [])
    caracteristicas = list(dict.fromkeys(carac_card + campos_llm["caracteristicas"])) or None

    # POIs
    pois = campos_llm["pois"] or None

    # ── Fotos ──────────────────────────────────────────────────────────────────
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
    fotos = fotos or None

    # ── Data de modificação ────────────────────────────────────────────────────
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

    if debug:
        log.debug(
            f"  RESULTADO: titulo='{titulo}' tipo={dados_card.get('tipo')} "
            f"bairro={bairro} preco={preco} area={area_m2} "
            f"quartos={quartos} suites={suites} banheiros={banheiros} garagem={garagem} "
            f"andar={andar} fotos={len(fotos) if fotos else 0} "
            f"carac={caracteristicas}"
        )
        log.debug(f"  pois={pois}")

    return {
        "url": url,
        "slug": extrair_slug(url),
        "titulo": titulo,
        "tipo": dados_card.get("tipo"),
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
        "caracteristicas": caracteristicas,
        "pois": pois,
        "fotos": fotos,
        "ultima_modificacao": ultima_modificacao,
        "endereco": endereco,
        "cep": cep,
        "latitude": latitude,
        "longitude": longitude,
        "status": "ativo",
        "scraped_at": datetime.utcnow().isoformat(),
    }


# ── Upsert no Supabase ─────────────────────────────────────────────────────────
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


def salvar_log(supabase: Client, log: dict):
    supabase.table("scraping_logs").insert(log).execute()


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

        # 1. Obtém nonce de segurança
        print("\n[1/3] Obtendo token de segurança...")
        security = obter_security(page)
        if not security:
            print("  ✗ Não foi possível obter o nonce. Abortando.")
            log.error("Nonce não encontrado — abortando")
            browser.close()
            return
        print(f"  ✓ security={security}")
        log.info(f"Nonce obtido: {security}")

        # 2. Coleta todos os imóveis via AJAX
        print("\n[2/3] Coletando lista de anúncios via AJAX...")
        todos_dados = coletar_via_ajax(page, security, debug=args.debug)
        print(f"  ✓ {len(todos_dados)} anúncios encontrados")
        log.info(f"Total coletado via AJAX: {len(todos_dados)} imóveis")

        if args.test:
            todos_dados = todos_dados[: args.test]
            print(f"  ▶ Modo teste: limitado a {args.test} imóveis")

        # 3. Scraping individual
        print("\n[3/3] Extraindo dados individuais...")
        slugs_ativos = []

        for i, dados_card in enumerate(todos_dados, 1):
            url = dados_card["url"]
            if not url:
                contadores["erros"] += 1
                continue

            slug = extrair_slug(url)
            slugs_ativos.append(slug)
            print(f"  [{i:>4}/{len(todos_dados)}] {slug[:55]}")

            try:
                dados = scrape_imovel(page, url, dados_card, debug=args.debug)
                if dados:
                    acao = upsert_imovel(supabase, dados)
                    contadores[acao + "s"] += 1
                    contadores["total"] += 1
                    preco_str = f"R${dados['preco']:,.0f}" if dados.get("preco") else "s/preço"
                    print(f"           ✓ {acao} | {preco_str} | {dados.get('bairro','?')}")
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

    # 4. Marca inativos
    if not args.test:
        print("\nVerificando imóveis inativos...")
        contadores["inativos"] = marcar_inativos(supabase, slugs_ativos)
        print(f"  ✓ {contadores['inativos']} marcados como inativos")

    # 5. Salva log
    fim = datetime.utcnow()
    salvar_log(supabase, {
        "iniciado_em":    inicio.isoformat(),
        "finalizado_em":  fim.isoformat(),
        "total":          contadores["total"],
        "inseridos":      contadores["inseridos"],
        "atualizados":    contadores["atualizados"],
        "inativos":       contadores["inativos"],
        "erros":          contadores["erros"],
        "log_detalhado":  {"erros": erros_log},
    })

    # 6. Relatório
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
