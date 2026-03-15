-- supabase/migrations/002_conversations.sql
CREATE TABLE conversations (
  id         BIGSERIAL PRIMARY KEY,
  chat_id    BIGINT NOT NULL,
  messages   JSONB  NOT NULL DEFAULT '[]',
  filters    JSONB  DEFAULT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX ON conversations(chat_id);
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
