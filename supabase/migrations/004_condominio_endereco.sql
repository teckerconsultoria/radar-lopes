-- Migration 004: Adicionar endereco e valor_condominio à tabela imoveis

ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS valor_condominio NUMERIC;
