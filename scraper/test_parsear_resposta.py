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
