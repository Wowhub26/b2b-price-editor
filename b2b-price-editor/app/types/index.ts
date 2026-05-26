// ============================================================
// SHARED TYPES — B2B Price Editor
// ============================================================

export interface ShopifyPriceList {
  id: string;
  name: string;
  currency: string;
}

export interface ShopifyCatalog {
  id: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  priceList: ShopifyPriceList | null;
  companyLocation?: {
    id: string;
    name: string;
    company: {
      id: string;
      name: string;
    };
  };
}

export interface VariantRow {
  // Identificatori
  variantId: string;
  productId: string;

  // Display
  productTitle: string;
  variantTitle: string;
  sku: string;
  imageUrl: string | null;

  // Prezzo standard Shopify — NON viene mai modificato dall'app
  shopifyPrice: string;
  shopifyCompareAtPrice: string | null;

  // Prezzo B2B corrente nella price list
  currentB2bPrice: string | null;
  currentCompareAtPrice: string | null;
  priceOrigin: "FIXED" | "RELATIVE" | "NONE";

  // Valori editati dall'utente (stato locale)
  newB2bPrice: string;
  newCompareAtPrice: string;

  // Stato riga
  status: "unchanged" | "modified" | "error" | "saved";
  validationError: string | null;
  compareAtError: string | null;
}

export interface BulkSaveResult {
  totalModified: number;
  saved: number;
  errors: number;
  skipped: number;
  errorDetails: Array<{
    variantId: string;
    sku: string;
    message: string;
  }>;
}

export interface CSVImportResult {
  imported: number;
  matched: number;
  notFound: number;
  invalid: number;
  details: Array<{
    row: number;
    variantId?: string;
    sku?: string;
    status: "matched" | "not_found" | "invalid";
    error?: string;
  }>;
}

// Payload per l'action di salvataggio
export interface SaveActionPayload {
  priceListId: string;
  currency: string;
  catalogId: string;
  catalogName: string;
  modifiedRows: VariantRow[];
}
