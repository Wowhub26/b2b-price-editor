// ============================================================
// PRICE UTILITIES — Validazione, calcoli, arrotondamenti
// ============================================================

/**
 * Valida un valore prezzo inserito dall'utente.
 * Restituisce null se valido, stringa di errore se non valido.
 */
export function validatePrice(
  value: string,
  options: { allowEmpty?: boolean; allowZero?: boolean } = {}
): string | null {
  const { allowEmpty = false, allowZero = false } = options;

  if (!value || value.trim() === "") {
    return allowEmpty ? null : "Il prezzo non può essere vuoto";
  }

  // Supporta sia virgola (italiano) che punto come separatore decimale
  const normalized = value.replace(",", ".");
  const num = parseFloat(normalized);

  if (isNaN(num)) return "Formato non valido — usa solo numeri (es. 29.90)";
  if (num < 0) return "Il prezzo non può essere negativo";
  if (!allowZero && num === 0) return "Il prezzo non può essere zero";

  // Massimo 2 decimali
  const parts = normalized.split(".");
  if (parts[1] && parts[1].length > 2) {
    return "Massimo 2 decimali consentiti";
  }

  return null;
}

/**
 * Normalizza un prezzo per l'API Shopify.
 * Shopify accetta sempre: punto come separatore, 2 decimali.
 */
export function normalizePrice(value: string): string {
  const num = parseFloat(value.replace(",", "."));
  if (isNaN(num)) return "0.00";
  return num.toFixed(2);
}

/**
 * Calcola la differenza in euro: nuovoPrezzo - prezzoStandard
 */
export function diffEuro(
  newPrice: string,
  shopifyPrice: string
): number | null {
  const n = parseFloat(newPrice.replace(",", "."));
  const s = parseFloat(shopifyPrice.replace(",", "."));
  if (isNaN(n) || isNaN(s)) return null;
  return parseFloat((n - s).toFixed(2));
}

/**
 * Calcola la differenza percentuale: ((nuovo - standard) / standard) * 100
 */
export function diffPercent(
  newPrice: string,
  shopifyPrice: string
): number | null {
  const n = parseFloat(newPrice.replace(",", "."));
  const s = parseFloat(shopifyPrice.replace(",", "."));
  if (isNaN(n) || isNaN(s) || s === 0) return null;
  return parseFloat((((n - s) / s) * 100).toFixed(2));
}

/**
 * Applica una variazione percentuale a un prezzo.
 * percentChange: +10 = +10%, -5 = -5%
 */
export function applyPercent(price: string, percentChange: number): string {
  const n = parseFloat(price.replace(",", "."));
  if (isNaN(n)) return price;
  const result = n * (1 + percentChange / 100);
  return Math.max(0.01, result).toFixed(2);
}

/**
 * Arrotonda un prezzo al centesimo desiderato.
 * cents: 90 → arrotonda a X,90 | 99 → arrotonda a X,99
 */
export function roundTo(price: string, cents: number): string {
  const n = parseFloat(price.replace(",", "."));
  if (isNaN(n)) return price;
  const floor = Math.floor(n);
  // Se già arrotondato correttamente, non cambiare
  const result = floor + cents / 100;
  return result.toFixed(2);
}

/**
 * Formatta un numero come valuta EUR per la UI.
 * Usa il formato italiano: 1.234,56 €
 */
export function fmt(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Controlla se un valore è cambiato rispetto al corrente.
 * Usato per determinare se una riga è "modified".
 */
export function hasChanged(
  newValue: string,
  currentValue: string | null,
  fallback: string
): boolean {
  const current = currentValue ?? fallback;
  const newNorm = parseFloat(newValue.replace(",", ".")).toFixed(2);
  const currentNorm = parseFloat(current.replace(",", ".")).toFixed(2);
  return newNorm !== currentNorm;
}
