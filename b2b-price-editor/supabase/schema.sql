-- ============================================================
-- SCHEMA SUPABASE — B2B Price Editor
-- WowHub SRL
--
-- Esegui questo script nell'SQL Editor di Supabase:
-- supabase.com → progetto → SQL Editor → New query → Incolla → Run
-- ============================================================

-- Log delle operazioni di salvataggio bulk
CREATE TABLE IF NOT EXISTS save_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Identificatori Shopify
  catalog_id      TEXT NOT NULL,
  catalog_name    TEXT NOT NULL,
  price_list_id   TEXT NOT NULL,

  -- Risultati dell'operazione
  total_modified  INT NOT NULL DEFAULT 0,
  total_saved     INT NOT NULL DEFAULT 0,
  total_errors    INT NOT NULL DEFAULT 0,
  total_skipped   INT NOT NULL DEFAULT 0,

  -- Performance
  duration_ms     INT,

  -- Chi ha eseguito (futuro: aggiungere user_id da auth)
  executed_by     TEXT DEFAULT 'admin',

  -- Stato finale dell'operazione
  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed'))
);

-- Dettaglio errori per ogni operazione di salvataggio
CREATE TABLE IF NOT EXISTS error_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- FK al log principale
  save_log_id     UUID NOT NULL REFERENCES save_logs(id) ON DELETE CASCADE,

  -- Riferimento alla variante che ha dato errore
  variant_id      TEXT NOT NULL,
  sku             TEXT,
  error_code      TEXT,
  error_message   TEXT NOT NULL
);

-- Indici per query frequenti
CREATE INDEX IF NOT EXISTS idx_save_logs_created_at
  ON save_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_save_logs_catalog_id
  ON save_logs(catalog_id);

CREATE INDEX IF NOT EXISTS idx_save_logs_status
  ON save_logs(status);

CREATE INDEX IF NOT EXISTS idx_error_logs_save_log_id
  ON error_logs(save_log_id);

-- Row Level Security (best practice)
-- L'app usa service_role key server-side → bypassa RLS
-- Abilitare RLS è comunque buona pratica di sicurezza
ALTER TABLE save_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Policy: nessun accesso dalla anon key (solo service_role)
-- Questo garantisce che i log siano accessibili solo dal server
CREATE POLICY "Nessun accesso pubblico ai save_logs"
  ON save_logs FOR ALL
  TO anon
  USING (false);

CREATE POLICY "Nessun accesso pubblico agli error_logs"
  ON error_logs FOR ALL
  TO anon
  USING (false);

-- ============================================================
-- Query utili per debug e monitoring
-- ============================================================

-- Ultimi 10 salvataggi:
-- SELECT * FROM save_logs ORDER BY created_at DESC LIMIT 10;

-- Tasso di errore per catalogo:
-- SELECT
--   catalog_name,
--   COUNT(*) as operazioni,
--   SUM(total_saved) as prezzi_salvati,
--   SUM(total_errors) as errori_totali,
--   ROUND(AVG(duration_ms)) as avg_durata_ms
-- FROM save_logs
-- GROUP BY catalog_name
-- ORDER BY operazioni DESC;

-- Errori recenti:
-- SELECT sl.catalog_name, el.sku, el.error_message, el.created_at
-- FROM error_logs el
-- JOIN save_logs sl ON sl.id = el.save_log_id
-- ORDER BY el.created_at DESC
-- LIMIT 50;
