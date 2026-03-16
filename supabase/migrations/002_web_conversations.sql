-- Tabela de histórico de conversas para o agente web
CREATE TABLE IF NOT EXISTS web_conversations (
  session_id    TEXT PRIMARY KEY,
  messages      JSONB NOT NULL DEFAULT '[]',
  filters       JSONB,
  prompt_version TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
