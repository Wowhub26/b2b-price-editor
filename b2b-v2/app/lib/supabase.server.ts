// ============================================================
// SUPABASE SESSION STORAGE
// Implementa l'interfaccia SessionStorage di @shopify/shopify-api
// per salvare i token OAuth su Supabase invece di SQLite.
// ============================================================

import { createClient } from "@supabase/supabase-js";
import type { Session, SessionStorage } from "@shopify/shopify-api";

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase non configurato: aggiungi SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nel .env"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Singleton
let _supabase: ReturnType<typeof getSupabaseClient> | null = null;
export function getSupabase() {
  if (!_supabase) _supabase = getSupabaseClient();
  return _supabase;
}

// ============================================================
// SESSION STORAGE — usato da shopify.server.ts
// ============================================================
export const supabaseSessionStorage: SessionStorage = {
  /**
   * Salva (insert o update) una sessione dopo il completamento OAuth.
   */
  async storeSession(session: Session): Promise<boolean> {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("shopify_sessions").upsert(
        {
          id: session.id,
          shop: session.shop,
          state: session.state,
          is_online: session.isOnline,
          scope: session.scope,
          expires: session.expires?.toISOString() ?? null,
          access_token: session.accessToken,
          user_id: session.onlineAccessInfo?.associated_user.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (error) {
        console.error("[SessionStorage] storeSession error:", error);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[SessionStorage] storeSession exception:", err);
      return false;
    }
  },

  /**
   * Carica una sessione per ID (chiamato ad ogni richiesta autenticata).
   */
  async loadSession(id: string): Promise<Session | undefined> {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("shopify_sessions")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) return undefined;

      // Ricostruisce l'oggetto Session di Shopify
      const session = new (
        await import("@shopify/shopify-api")
      ).Session({
        id: data.id,
        shop: data.shop,
        state: data.state ?? "",
        isOnline: data.is_online,
      });

      session.scope = data.scope ?? undefined;
      session.expires = data.expires ? new Date(data.expires) : undefined;
      session.accessToken = data.access_token ?? undefined;

      return session;
    } catch (err) {
      console.error("[SessionStorage] loadSession exception:", err);
      return undefined;
    }
  },

  /**
   * Elimina una sessione (logout o disinstallazione app).
   */
  async deleteSession(id: string): Promise<boolean> {
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("shopify_sessions")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("[SessionStorage] deleteSession error:", error);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[SessionStorage] deleteSession exception:", err);
      return false;
    }
  },

  /**
   * Elimina tutte le sessioni di uno store (webhook app/uninstalled).
   */
  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("shopify_sessions")
        .delete()
        .in("id", ids);

      if (error) {
        console.error("[SessionStorage] deleteSessions error:", error);
        return false;
      }
      return true;
    } catch (err) {
      console.error("[SessionStorage] deleteSessions exception:", err);
      return false;
    }
  },

  /**
   * Trova le sessioni di uno store (usato internamente da Shopify).
   */
  async findSessionsByShop(shop: string): Promise<Session[]> {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("shopify_sessions")
        .select("*")
        .eq("shop", shop);

      if (error || !data) return [];

      const { Session } = await import("@shopify/shopify-api");

      return data.map((row) => {
        const session = new Session({
          id: row.id,
          shop: row.shop,
          state: row.state ?? "",
          isOnline: row.is_online,
        });
        session.scope = row.scope ?? undefined;
        session.expires = row.expires ? new Date(row.expires) : undefined;
        session.accessToken = row.access_token ?? undefined;
        return session;
      });
    } catch (err) {
      console.error("[SessionStorage] findSessionsByShop exception:", err);
      return [];
    }
  },
};

// ============================================================
// LOG OPERAZIONI BULK — separato dal session storage
// ============================================================
import type { BulkSaveResult } from "~/types";

export async function logSaveOperation(params: {
  shop: string;
  catalogId: string;
  catalogName: string;
  priceListId: string;
  result: BulkSaveResult;
  durationMs: number;
}): Promise<void> {
  try {
    const supabase = getSupabase();
    const { shop, catalogId, catalogName, priceListId, result, durationMs } =
      params;

    const status: "success" | "partial" | "failed" =
      result.errors === 0 && result.saved > 0
        ? "success"
        : result.saved > 0
        ? "partial"
        : "failed";

    const { data: saveLog, error: logError } = await supabase
      .from("save_logs")
      .insert({
        shop,
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
      console.error("[Supabase] Errore save_log:", logError);
      return;
    }

    if (result.errorDetails.length > 0) {
      await supabase.from("error_logs").insert(
        result.errorDetails.map((e) => ({
          save_log_id: saveLog.id,
          variant_id: e.variantId,
          sku: e.sku || null,
          error_message: e.message,
        }))
      );
    }
  } catch (err) {
    console.error("[Supabase] logSaveOperation exception:", err);
  }
}
