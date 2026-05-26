-- ============================================================
-- SCHEMA SUPABASE — B2B Price Editor
-- WowHub SRL
--
-- Esegui nell'SQL Editor di Supabase:
-- supabase.com → progetto → SQL Editor → New query → Run
-- ============================================================

-- ============================================================
-- SESSIONI SHOPIFY (OAuth)
-- Sostituisce il database SQLite/Prisma del template Remix.
-- Shopify salva qui il token dopo l'installazione dell'app.
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_sessions (
  id              TEXT PRIMARY KEY,         -- session ID generato da Shopify
  shop            TEXT NOT NULL,            -- es. "your-store.myshopify.com"
  state           TEXT,                     -- usato durante il flow OAuth
  is_online       BOOLEAN NOT NULL DEFAULT false,
  scope           TEXT,                     -- scopes concessi dallo store
  expires         TIMESTAMPTZ,              -- scadenza token (offline = null)
  access_token    TEXT,                     -- token OAuth — trattare come segreto
  user_id         BIGINT,                   -- per sessioni online (per-user)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_shop
  ON shopify_sessions(shop);

-- ============================================================
-- LOG OPERAZIONI BULK
-- ============================================================
CREATE TABLE IF NOT EXISTS save_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  shop            TEXT NOT NULL,            -- store che ha eseguito l'operazione
  catalog_id      TEXT NOT NULL,
  catalog_name    TEXT NOT NULL,
  price_list_id   TEXT NOT NULL,

  total_modified  INT NOT NULL DEFAULT 0,
  total_saved     INT NOT NULL DEFAULT 0,
  total_errors    INT NOT NULL DEFAULT 0,
  total_skipped   INT NOT NULL DEFAULT 0,
  duration_ms     INT,

  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_save_logs_shop
  ON save_logs(shop, created_at DESC);

-- ============================================================
-- DETTAGLIO ERRORI
-- ============================================================
CREATE TABLE IF NOT EXISTS error_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  save_log_id     UUID NOT NULL REFERENCES save_logs(id) ON DELETE CASCADE,
  variant_id      TEXT NOT NULL,
  sku             TEXT,
  error_message   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_logs_save_log_id
  ON error_logs(save_log_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- L'app usa service_role key server-side → bypassa RLS.
-- RLS attivo come difesa aggiuntiva.
-- ============================================================
ALTER TABLE shopify_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE save_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access - shopify_sessions"
  ON shopify_sessions FOR ALL TO anon USING (false);

CREATE POLICY "No public access - save_logs"
  ON save_logs FOR ALL TO anon USING (false);

CREATE POLICY "No public access - error_logs"
  ON error_logs FOR ALL TO anon USING (false);
