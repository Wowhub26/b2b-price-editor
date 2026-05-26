// ============================================================
// CSV UTILITIES — Import ed Export
// ============================================================

import Papa from "papaparse";
import type { VariantRow, CSVImportResult } from "~/types";
import { validatePrice } from "./priceUtils";

// ============================================================
// EXPORT
// ============================================================

/**
 * Esporta tutte le righe della tabella come file CSV scaricabile.
 * Chiama questa funzione solo nel browser (client-side).
 */
export function exportToCSV(
  rows: VariantRow[],
  catalogId: string,
  catalogName: string,
  priceListId: string
): void {
  const data = rows.map((r) => ({
    "Catalog ID": catalogId,
    "Catalog Name": catalogName,
    "Price List ID": priceListId,
    "Product ID": r.productId,
    "Product Title": r.productTitle,
    "Variant ID": r.variantId,
    "Variant Title": r.variantTitle,
    SKU: r.sku,
    "Shopify Price": r.shopifyPrice,
    "Current B2B Price": r.currentB2bPrice ?? "",
    "New B2B Price": r.status === "modified" ? r.newB2bPrice : "",
    "Compare At Price": r.newCompareAtPrice ?? "",
    Status: r.status,
  }));

  const csv = Papa.unparse(data, {
    quotes: true,
    delimiter: ",",
  });

  const bom = "\uFEFF"; // BOM per compatibilità Excel con UTF-8
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const filename = `b2b-catalog-${catalogName
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================
// IMPORT
// ============================================================

/**
 * Importa un file CSV e aggiorna le righe della tabella.
 *
 * IMPORTANTE: Questa funzione NON salva nulla su Shopify.
 * Aggiorna solo lo stato locale della tabella.
 * Il salvataggio avviene solo dopo click su "Salva modifiche".
 *
 * Logica di matching (in ordine di priorità):
 * 1. Variant ID (GID completo o solo numero)
 * 2. SKU (se Variant ID non trovato)
 *
 * Colonne CSV riconosciute:
 * - "Variant ID" (obbligatorio o SKU)
 * - "SKU"
 * - "New B2B Price" (obbligatorio)
 * - "Compare At Price" (opzionale)
 */
export function importFromCSV(
  file: File,
  currentRows: VariantRow[],
  onComplete: (updatedRows: VariantRow[], result: CSVImportResult) => void
): void {
  // Costruisce le mappe per lookup veloce O(1)
  const byVariantId = new Map<string, number>();
  const bySku = new Map<string, number>();
  const skuCount = new Map<string, number>();

  currentRows.forEach((row, index) => {
    byVariantId.set(row.variantId, index);
    if (row.sku) {
      bySku.set(row.sku, index);
      skuCount.set(row.sku, (skuCount.get(row.sku) ?? 0) + 1);
    }
  });

  // SKU duplicati nel catalogo corrente
  const duplicateSkus = new Set(
    [...skuCount.entries()]
      .filter(([, count]) => count > 1)
      .map(([sku]) => sku)
  );

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (value) => value.trim(),

    complete: (parsed) => {
      const result: CSVImportResult = {
        imported: parsed.data.length,
        matched: 0,
        notFound: 0,
        invalid: 0,
        details: [],
      };

      const updatedRows = [...currentRows];

      (parsed.data as Record<string, string>[]).forEach((csvRow, rowIndex) => {
        const humanRow = rowIndex + 2; // +1 per header, +1 per indice 0
        const csvVariantId = csvRow["Variant ID"]?.trim() ?? "";
        const csvSku = csvRow["SKU"]?.trim() ?? "";
        const rawNewPrice = csvRow["New B2B Price"]?.trim() ?? "";
        const rawCompareAt = csvRow["Compare At Price"]?.trim() ?? "";

        // === Trova la riga corrispondente ===
        let targetIndex: number | undefined;

        if (csvVariantId) {
          // Supporta sia GID completo che solo il numero ID
          const gid = csvVariantId.startsWith("gid://shopify/ProductVariant/")
            ? csvVariantId
            : `gid://shopify/ProductVariant/${csvVariantId}`;
          targetIndex = byVariantId.get(gid);
        }

        if (targetIndex === undefined && csvSku) {
          if (duplicateSkus.has(csvSku)) {
            result.invalid++;
            result.details.push({
              row: humanRow,
              sku: csvSku,
              status: "invalid",
              error: `SKU duplicato nel catalogo — usa Variant ID per identificare univocamente la riga`,
            });
            return;
          }
          targetIndex = bySku.get(csvSku);
        }

        if (targetIndex === undefined) {
          result.notFound++;
          result.details.push({
            row: humanRow,
            variantId: csvVariantId || undefined,
            sku: csvSku || undefined,
            status: "not_found",
            error: "Variante non trovata nel catalogo corrente",
          });
          return;
        }

        // === Valida il prezzo ===
        if (!rawNewPrice) {
          result.invalid++;
          result.details.push({
            row: humanRow,
            variantId: csvVariantId || undefined,
            sku: csvSku || undefined,
            status: "invalid",
            error: "Colonna 'New B2B Price' mancante o vuota",
          });
          return;
        }

        const priceError = validatePrice(rawNewPrice);
        if (priceError) {
          result.invalid++;
          result.details.push({
            row: humanRow,
            variantId: csvVariantId || undefined,
            sku: csvSku || undefined,
            status: "invalid",
            error: `Prezzo non valido: ${priceError}`,
          });
          return;
        }

        // Valida il compare-at se presente
        const compareAtError = rawCompareAt
          ? validatePrice(rawCompareAt, { allowEmpty: true })
          : null;

        // === Aggiorna la riga (solo stato locale — non salva su Shopify) ===
        const normalizedPrice = parseFloat(rawNewPrice.replace(",", ".")).toFixed(2);
        const normalizedCompareAt = rawCompareAt
          ? parseFloat(rawCompareAt.replace(",", ".")).toFixed(2)
          : updatedRows[targetIndex].newCompareAtPrice;

        updatedRows[targetIndex] = {
          ...updatedRows[targetIndex],
          newB2bPrice: normalizedPrice,
          newCompareAtPrice: normalizedCompareAt,
          status: "modified",
          validationError: null,
          compareAtError: compareAtError,
        };

        result.matched++;
        result.details.push({
          row: humanRow,
          variantId: csvVariantId || undefined,
          sku: csvSku || undefined,
          status: "matched",
        });
      });

      onComplete(updatedRows, result);
    },

    error: (err) => {
      console.error("[CSV Import] Errore di parsing:", err);
      onComplete(currentRows, {
        imported: 0,
        matched: 0,
        notFound: 0,
        invalid: 1,
        details: [
          {
            row: 0,
            status: "invalid",
            error: `Errore lettura file CSV: ${err.message}`,
          },
        ],
      });
    },
  });
}
