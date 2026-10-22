-- Índice da busca textual no histórico. Não altera mensagens nem dados da Meta.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Message_history_search_trgm_idx" ON "Message"
USING GIN ((COALESCE(text, '') || ' ' || COALESCE(caption, '') || ' ' || COALESCE("renderedText", '')) gin_trgm_ops);
