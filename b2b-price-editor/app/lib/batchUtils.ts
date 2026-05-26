// ============================================================
// BATCH UTILITIES — Salvataggio bulk con gestione rate limits
// ============================================================

import { shopifyGraphQL, sleep } from "./shopify.server";
import { PRICE_LIST_FIXED_PRICES_UPDATE } from "./graphql/mutations";
import type { VariantRow, BulkSaveResult } from "~/types";

// Shopify Admin GraphQL: limite sicuro per una singola mutazione
const CHUNK_SIZE = 250;

// Pausa tra chunk per rispettare il rate limit Shopify
// (1000 punti/s, il bucket si ripristina a ~50 punti/s)
const DELAY_BETWEEN_CHUNKS_MS = 600;

// Retry in caso di errore temporaneo (es. 429 Too Many Requests)
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

interface PriceListPriceInput {
  variantId: string;
  price: { amount: string; currencyCode: string };
  compareAtPrice?: { amount: string; currencyCode: string } | null;
}

interface MutationResponse {
  priceListFixedPricesUpdate: {
    priceList: { id: string; name: string } | null;
    pricesAdded: Array<{
      price: { amount: string; currencyCode: string };
      compareAtPrice: { amount: string; currencyCode: string } | null;
      variant: { id: string; sku: string };
    }>;
    deletedFixedPriceVariantIds: string[];
    userErrors: Array<{
      field: string[];
      message: string;
      code: string;
    }>;
  };
}

/**
 * Esegue il salvataggio bulk dei prezzi B2B in chunks.
 *
 * Strategia:
 * 1. Prepara gli input per Shopify (solo righe valide e modificate)
 * 2. Divide in chunks da CHUNK_SIZE
 * 3. Esegue ogni chunk con retry in caso di errore
 * 4. Pausa tra i chunks per rispettare i rate limits
 * 5. Restituisce un riepilogo completo
 *
 * IMPORTANTE: Non modifica mai il prezzo standard dei prodotti Shopify.
 * Agisce solo sulla price list B2B specificata.
 */
export async function savePricesInBatches(
  priceListId: string,
  currency: string,
  modifiedRows: VariantRow[]
): Promise<BulkSaveResult> {
  const result: BulkSaveResult = {
    totalModified: modifiedRows.length,
    saved: 0,
    errors: 0,
    skipped: 0,
    errorDetails: [],
  };

  if (modifiedRows.length === 0) {
    return result;
  }

  // Filtra solo le righe valide (senza errori di validazione)
  const validRows = modifiedRows.filter((row) => row.validationError === null);
  result.skipped = modifiedRows.length - validRows.length;

  if (result.skipped > 0) {
    console.log(
      `[Batch] Saltate ${result.skipped} righe con errori di validazione`
    );
  }

  // Prepara gli input per Shopify
  const toAdd: PriceListPriceInput[] = validRows.map((row) => {
    const input: PriceListPriceInput = {
      variantId: row.variantId,
      price: {
        amount: parseFloat(row.newB2bPrice).toFixed(2),
        currencyCode: currency,
      },
    };

    // Aggiunge compare-at price solo se presente e valido
    if (row.newCompareAtPrice && row.newCompareAtPrice.trim() !== "") {
      const compareAtNum = parseFloat(row.newCompareAtPrice);
      if (!isNaN(compareAtNum) && compareAtNum > 0) {
        input.compareAtPrice = {
          amount: compareAtNum.toFixed(2),
          currencyCode: currency,
        };
      }
    } else {
      // null rimuove il compare-at price esistente
      input.compareAtPrice = null;
    }

    return input;
  });

  // Divide in chunks
  const chunks: PriceListPriceInput[][] = [];
  for (let i = 0; i < toAdd.length; i += CHUNK_SIZE) {
    chunks.push(toAdd.slice(i, i + CHUNK_SIZE));
  }

  console.log(
    `[Batch] Inizio salvataggio: ${toAdd.length} prezzi in ${chunks.length} chunk(s)`
  );

  // Elabora ogni chunk
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    console.log(
      `[Batch] Chunk ${chunkIndex + 1}/${chunks.length}: ${chunk.length} prezzi`
    );

    let success = false;
    let lastError: Error | null = null;

    // Retry loop
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const data = await shopifyGraphQL<MutationResponse>(
          PRICE_LIST_FIXED_PRICES_UPDATE,
          {
            priceListId,
            toAdd: chunk,
            toDelete: [], // Non gestiamo delete in questo flusso
          }
        );

        const mutation = data.priceListFixedPricesUpdate;

        // Conta i successi
        const savedCount = mutation.pricesAdded.length;
        result.saved += savedCount;

        // Registra i userErrors di Shopify (errori per singola riga)
        for (const userError of mutation.userErrors) {
          result.errors++;
          // Il campo field può contenere l'indice della variante
          const variantRef = userError.field?.join(".") ?? "unknown";
          result.errorDetails.push({
            variantId: variantRef,
            sku: "",
            message: `[${userError.code}] ${userError.message}`,
          });
        }

        success = true;
        break; // Chunk completato con successo, esci dal retry loop
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(
          `[Batch] Chunk ${chunkIndex + 1}, tentativo ${attempt}/${MAX_RETRIES} fallito:`,
          lastError.message
        );

        if (attempt < MAX_RETRIES) {
          const retryDelay = RETRY_DELAY_MS * attempt; // Backoff esponenziale
          console.log(`[Batch] Retry in ${retryDelay}ms...`);
          await sleep(retryDelay);
        }
      }
    }

    // Se tutti i retry sono falliti, marca tutte le righe del chunk come errore
    if (!success && lastError) {
      for (const item of chunk) {
        result.errors++;
        result.errorDetails.push({
          variantId: item.variantId,
          sku: "",
          message: `Errore rete dopo ${MAX_RETRIES} tentativi: ${lastError.message}`,
        });
      }
    }

    // Pausa tra i chunks (tranne dopo l'ultimo)
    if (chunkIndex < chunks.length - 1) {
      await sleep(DELAY_BETWEEN_CHUNKS_MS);
    }
  }

  console.log(
    `[Batch] Completato: ${result.saved} salvati, ${result.errors} errori, ${result.skipped} saltati`
  );

  return result;
}
