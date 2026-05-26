// ============================================================
// BATCH UTILS — Salvataggio bulk con client OAuth Shopify
// Riceve il client 'admin' da authenticate.admin(request),
// non usa token fisso né fetch manuale.
// ============================================================

import { sleep } from "./shopify.server";
import { PRICE_LIST_FIXED_PRICES_UPDATE } from "./graphql/mutations";
import type { VariantRow, BulkSaveResult } from "~/types";

const CHUNK_SIZE = 250;
const DELAY_BETWEEN_CHUNKS_MS = 600;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

interface PriceListPriceInput {
  variantId: string;
  price: { amount: string; currencyCode: string };
  compareAtPrice?: { amount: string; currencyCode: string } | null;
}

// Tipo del client admin restituito da authenticate.admin()
type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<{ json: () => Promise<Record<string, unknown>> }>;
};

export async function savePricesInBatches(
  admin: AdminClient,
  priceListId: string,
  currency: string,
  modifiedRows: VariantRow[]
): Promise<BulkSaveResult> {
  const result: BulkSaveResult = {
    totalModified: modifiedRows.length,
    saved: 0, errors: 0, skipped: 0, errorDetails: [],
  };

  if (modifiedRows.length === 0) return result;

  const validRows = modifiedRows.filter((r) => r.validationError === null);
  result.skipped = modifiedRows.length - validRows.length;

  const toAdd: PriceListPriceInput[] = validRows.map((row) => ({
    variantId: row.variantId,
    price: {
      amount: parseFloat(row.newB2bPrice).toFixed(2),
      currencyCode: currency,
    },
    compareAtPrice:
      row.newCompareAtPrice && row.newCompareAtPrice.trim() !== ""
        ? {
            amount: parseFloat(row.newCompareAtPrice).toFixed(2),
            currencyCode: currency,
          }
        : null,
  }));

  const chunks: PriceListPriceInput[][] = [];
  for (let i = 0; i < toAdd.length; i += CHUNK_SIZE) {
    chunks.push(toAdd.slice(i, i + CHUNK_SIZE));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    let success = false;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Usa il client admin OAuth — nessun token manuale
        const response = await admin.graphql(PRICE_LIST_FIXED_PRICES_UPDATE, {
          variables: { priceListId, toAdd: chunk, toDelete: [] },
        });
        const json = await response.json() as {
          data: {
            priceListFixedPricesUpdate: {
              pricesAdded: Array<{ variant: { id: string; sku: string } }>;
              userErrors: Array<{ field: string[]; message: string; code: string }>;
            };
          };
        };

        const mutation = json.data.priceListFixedPricesUpdate;
        result.saved += mutation.pricesAdded.length;

        for (const ue of mutation.userErrors) {
          result.errors++;
          result.errorDetails.push({
            variantId: ue.field?.join(".") ?? "unknown",
            sku: "",
            message: `[${ue.code}] ${ue.message}`,
          });
        }

        success = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
      }
    }

    if (!success && lastError) {
      for (const item of chunk) {
        result.errors++;
        result.errorDetails.push({
          variantId: item.variantId,
          sku: "",
          message: `Errore dopo ${MAX_RETRIES} tentativi: ${lastError.message}`,
        });
      }
    }

    if (ci < chunks.length - 1) await sleep(DELAY_BETWEEN_CHUNKS_MS);
  }

  return result;
}
