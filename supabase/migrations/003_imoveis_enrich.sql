-- Migration 003: Enriquecimento de imóveis com dados qualitativos da descrição
-- Executa via: Supabase MCP apply_migration

ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS detalhes_imovel JSONB;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS mobiliado BOOLEAN;
