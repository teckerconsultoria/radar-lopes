-- ============================================================
-- Radar Lopes — Schema Inicial
-- Lopes de Andrade Imóveis
-- ============================================================

-- Tabela principal de imóveis
CREATE TABLE IF NOT EXISTS imoveis (
  id                   BIGSERIAL PRIMARY KEY,
  url                  TEXT UNIQUE NOT NULL,
  slug                 TEXT,
  titulo               TEXT NOT NULL,
  tipo                 TEXT,
  bairro               TEXT,
  cidade               TEXT DEFAULT 'João Pessoa',
  uf                   TEXT DEFAULT 'PB',

  -- Características numéricas
  preco                NUMERIC,
  area_m2              NUMERIC,
  quartos              INTEGER,
  suites               INTEGER,
  banheiros            INTEGER,
  garagem              INTEGER,
  andar                INTEGER,
  total_andares        INTEGER,

  -- Flags booleanas
  eh_terreo            BOOLEAN DEFAULT FALSE,
  eh_cobertura         BOOLEAN DEFAULT FALSE,
  aceita_financiamento BOOLEAN,
  novo                 BOOLEAN DEFAULT FALSE,
  reformado            BOOLEAN DEFAULT FALSE,

  -- Arrays e texto longo
  caracteristicas      TEXT[],
  pois                 TEXT[],
  descricao            TEXT,
  fotos                TEXT[],

  -- Metadados
  status               TEXT DEFAULT 'ativo',
  fonte                INTEGER DEFAULT 1,
  ultima_modificacao   DATE,
  scraped_at           TIMESTAMPTZ DEFAULT NOW(),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),

  -- Full-Text Search em português
  fts                  TSVECTOR GENERATED ALWAYS AS (
                         to_tsvector('portuguese',
                           COALESCE(titulo, '') || ' ' ||
                           COALESCE(bairro, '') || ' ' ||
                           COALESCE(tipo, '') || ' ' ||
                           COALESCE(descricao, '') || ' ' ||
                           COALESCE(array_to_string(caracteristicas, ' '), '') || ' ' ||
                           COALESCE(array_to_string(pois, ' '), '')
                         )
                       ) STORED
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_imoveis_fts      ON imoveis USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_imoveis_tipo     ON imoveis(tipo);
CREATE INDEX IF NOT EXISTS idx_imoveis_bairro   ON imoveis(bairro);
CREATE INDEX IF NOT EXISTS idx_imoveis_quartos  ON imoveis(quartos);
CREATE INDEX IF NOT EXISTS idx_imoveis_suites   ON imoveis(suites);
CREATE INDEX IF NOT EXISTS idx_imoveis_preco    ON imoveis(preco);
CREATE INDEX IF NOT EXISTS idx_imoveis_area     ON imoveis(area_m2);
CREATE INDEX IF NOT EXISTS idx_imoveis_status   ON imoveis(status);
CREATE INDEX IF NOT EXISTS idx_imoveis_andar    ON imoveis(andar);
CREATE INDEX IF NOT EXISTS idx_imoveis_garagem  ON imoveis(garagem);
CREATE INDEX IF NOT EXISTS idx_imoveis_atualiz  ON imoveis(ultima_modificacao);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_imoveis_updated_at
  BEFORE UPDATE ON imoveis
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tabela de logs de scraping
CREATE TABLE IF NOT EXISTS scraping_logs (
  id            BIGSERIAL PRIMARY KEY,
  iniciado_em   TIMESTAMPTZ DEFAULT NOW(),
  finalizado_em TIMESTAMPTZ,
  total         INTEGER,
  inseridos     INTEGER,
  atualizados   INTEGER,
  inativos      INTEGER,
  erros         INTEGER,
  log_detalhado JSONB
);

-- RLS desabilitado (uso interno via service key)
ALTER TABLE imoveis        DISABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_logs  DISABLE ROW LEVEL SECURITY;
