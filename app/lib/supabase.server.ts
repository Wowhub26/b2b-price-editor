// ============================================================
// SUPABASE CLIENT — Solo server-side (service_role key)
// NON importare mai questo file nel browser/client
// ============================================================

import { createClient } from "@supabase/supabase-js";
import type { BulkSaveResult } from "~/types";

// Lazy singleton — evita di creare il client ad ogni richiesta
let _supabase: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        "Supabase non configurato: aggiungi SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nel .env"
      );
    }

    _supabase = createClient(url, key, {
      auth: {
        // La service_role key non usa session — disabilita persistenza
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _supabase;
}

// ============================================================
// SAVE LOGS
// ============================================================

/**
 * Salva il log di un'operazione bulk su Supabase.
 * Non lancia errori — in caso di fallimento logga solo in console.
 * Il fallimento del log non deve bloccare l'app.
 */
export async function logSaveOperation(params: {
  catalogId: string;
  catalogName: string;
  priceListId: string;
  result: BulkSaveResult;
  durationMs: number;
}): Promise<void> {
  try {
    const supabase = getSupabase();
    const { catalogId, catalogName, priceListId, result, durationMs } = params;

    const status: "success" | "partial" | "failed" =
      result.errors === 0 && result.saved > 0
        ? "success"
        : result.saved > 0
        ? "partial"
        : "failed";

    // Inserisce il log principale
    const { data: saveLog, error: logError } = await supabase
      .from("save_logs")
      .insert({
        catalog_id: catalogId,
        catalog_name: catalogName,
        price_list_id: priceListId,
        total_modified: result.totalModified,
        total_saved: result.saved,
        total_errors: result.errors,
        total_skipped: result.skipped,
        duration_ms: durationMs,
        status,
      })
      .select("id")
      .single();

    if (logError || !saveLog) {
      console.error("[Supabase] Errore inserimento save_log:", logError);
      return;
    }

    // Inserisce i dettagli degli errori (se presenti)
    if (result.errorDetails.length > 0) {
      const errorRows = result.errorDetails.map((e) => ({
        save_log_id: saveLog.id,
        variant_id: e.variantId,
        sku: e.sku || null,
        error_message: e.message,
      }));

      const { error: errError } = await supabase
        .from("error_logs")
        .insert(errorRows);

      if (errError) {
        console.error("[Supabase] Errore inserimento error_logs:", errError);
      }
    }

    console.log(`[Supabase] Log salvato: ${saveLog.id} (${status})`);
  } catch (err) {
    // Failsafe: il log non deve mai far crashare l'app
    console.error("[Supabase] Eccezione nel logSaveOperation:", err);
  }
}

/**
 * Recupera la history degli ultimi N salvataggi.
 */
export async function getSaveLogs(limit = 20) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("save_logs")
    .select(`
      *,
      error_logs (
        id,
        variant_id,
        sku,
        error_message,
        created_at
      )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[Supabase] Errore nel getSaveLogs:", error);
    return [];
  }

  return data ?? [];
}
