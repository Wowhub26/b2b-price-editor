import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  Button,
  TextField,
  Banner,
  Modal,
  Text,
  Badge,
  ButtonGroup,
  ActionList,
  Popover,
  Spinner,
  Thumbnail,
  Checkbox,
  Box,
  InlineStack,
  BlockStack,
  DataTable,
  ProgressBar,
  Divider,
} from "@shopify/polaris";

import { shopifyGraphQL, fetchAllPages } from "~/lib/shopify.server";
import { logSaveOperation } from "~/lib/supabase.server";
import { savePricesInBatches } from "~/lib/batchUtils";
import { exportToCSV, importFromCSV } from "~/lib/csvUtils";
import {
  validatePrice,
  diffEuro,
  diffPercent,
  applyPercent,
  roundTo,
  fmt,
  hasChanged,
} from "~/lib/priceUtils";
import {
  GET_CATALOG_DETAIL,
  GET_PRICELIST_PRICES,
  GET_PRODUCTS_WITH_VARIANTS,
} from "~/lib/graphql/queries";
import type {
  VariantRow,
  ShopifyCatalog,
  BulkSaveResult,
  CSVImportResult,
  SaveActionPayload,
} from "~/types";

// ============================================================
// TYPES interni al loader
// ============================================================
interface PriceNode {
  price: { amount: string; currencyCode: string };
  compareAtPrice: { amount: string; currencyCode: string } | null;
  originType: "FIXED" | "RELATIVE";
  variant: { id: string; sku: string };
}

interface ProductNode {
  id: string;
  title: string;
  vendor: string;
  featuredImage: { url: string } | null;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      sku: string;
      price: string;
      compareAtPrice: string | null;
      image: { url: string } | null;
    }>;
  };
}

// ============================================================
// LOADER — Carica catalogo, price list e varianti
// ============================================================
export async function loader({ params }: LoaderFunctionArgs) {
  const catalogId = decodeURIComponent(params.catalogId!);

  // 1. Dettaglio catalogo
  const catalogData = await shopifyGraphQL<{ catalog: ShopifyCatalog }>(
    GET_CATALOG_DETAIL,
    { id: catalogId }
  );

  const catalog = catalogData.catalog;

  if (!catalog) {
    throw new Response("Catalogo non trovato", { status: 404 });
  }
  if (!catalog.priceList) {
    throw new Response(
      "Il catalogo selezionato non ha una Price List collegata",
      { status: 400 }
    );
  }

  const priceListId = catalog.priceList.id;

  // 2. Recupera TUTTI i prezzi fissi dalla price list (con pagination)
  const priceMap = new Map<string, PriceNode>();

  const priceNodes = await fetchAllPages<PriceNode>(
    async (first, after) => {
      const data = await shopifyGraphQL<{
        priceList: {
          prices: {
            pageInfo: { hasNextPage: boolean; endCursor: string };
            nodes: PriceNode[];
          };
        };
      }>(GET_PRICELIST_PRICES, { priceListId, first, after });
      return data.priceList.prices;
    },
    250 // Prezzi: 250 per pagina (massimo sicuro)
  );

  for (const node of priceNodes) {
    priceMap.set(node.variant.id, node);
  }

  // 3. Recupera TUTTI i prodotti/varianti (con pagination)
  const productNodes = await fetchAllPages<ProductNode>(
    async (first, after) => {
      const data = await shopifyGraphQL<{
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          nodes: ProductNode[];
        };
      }>(GET_PRODUCTS_WITH_VARIANTS, { first, after });
      return data.products;
    },
    50 // Prodotti: 50 per pagina
  );

  // 4. Costruisce le VariantRow unendo prodotti + prezzi B2B
  const variants: VariantRow[] = [];

  for (const product of productNodes) {
    for (const variant of product.variants.nodes) {
      const b2bPrice = priceMap.get(variant.id);

      variants.push({
        variantId: variant.id,
        productId: product.id,
        productTitle: product.title,
        variantTitle: variant.title,
        sku: variant.sku ?? "",
        imageUrl:
          variant.image?.url ?? product.featuredImage?.url ?? null,
        shopifyPrice: variant.price,
        shopifyCompareAtPrice: variant.compareAtPrice,
        currentB2bPrice: b2bPrice?.price.amount ?? null,
        currentCompareAtPrice: b2bPrice?.compareAtPrice?.amount ?? null,
        priceOrigin: b2bPrice?.originType ?? "NONE",
        // Prezzo iniziale nell'editor: B2B se esiste, altrimenti prezzo Shopify
        newB2bPrice: b2bPrice?.price.amount ?? variant.price,
        newCompareAtPrice: b2bPrice?.compareAtPrice?.amount ?? "",
        status: "unchanged",
        validationError: null,
        compareAtError: null,
      });
    }
  }

  return json({ catalog, priceListId, variants });
}

// ============================================================
// ACTION — Salva prezzi su Shopify + log su Supabase
// ============================================================
export async function action({ request }: ActionFunctionArgs) {
  const body: SaveActionPayload = await request.json();
  const start = Date.now();

  let result: BulkSaveResult;

  try {
    result = await savePricesInBatches(
      body.priceListId,
      body.currency,
      body.modifiedRows
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return json(
      {
        result: {
          totalModified: body.modifiedRows.length,
          saved: 0,
          errors: body.modifiedRows.length,
          skipped: 0,
          errorDetails: [{ variantId: "", sku: "", message }],
        } satisfies BulkSaveResult,
      },
      { status: 500 }
    );
  }

  // Log asincrono su Supabase — non blocca la risposta
  logSaveOperation({
    catalogId: body.catalogId,
    catalogName: body.catalogName,
    priceListId: body.priceListId,
    result,
    durationMs: Date.now() - start,
  }).catch((err) =>
    console.error("[Action] Errore log Supabase:", err)
  );

  return json({ result });
}

// ============================================================
// COMPONENT — Step 2: Bulk Editor
// ============================================================
export default function Step2BulkEditor() {
  const { catalog, priceListId, variants: initialVariants } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ result: BulkSaveResult }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevFetcherState = useRef(fetcher.state);

  // ---- State ----
  const [rows, setRows] = useState<VariantRow[]>(initialVariants);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveResult, setSaveResult] = useState<BulkSaveResult | null>(null);
  const [csvResult, setCsvResult] = useState<CSVImportResult | null>(null);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [bulkPercent, setBulkPercent] = useState("10");

  // ---- Computed ----
  const modifiedRows = useMemo(
    () => rows.filter((r) => r.status === "modified"),
    [rows]
  );
  const hasErrors = useMemo(
    () => rows.some((r) => r.validationError !== null),
    [rows]
  );
  const canSave = modifiedRows.length > 0 && !hasErrors;
  const isSaving = fetcher.state !== "idle";

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.productTitle.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        r.variantTitle.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // ---- Effetto: gestisce risposta dal fetcher ----
  useEffect(() => {
    if (
      prevFetcherState.current !== "idle" &&
      fetcher.state === "idle" &&
      fetcher.data?.result
    ) {
      const result = fetcher.data.result;
      setSaveResult(result);

      // Aggiorna i prezzi "correnti" nella tabella dopo salvataggio riuscito
      if (result.saved > 0) {
        setRows((prev) =>
          prev.map((r) => {
            if (r.status !== "modified") return r;
            return {
              ...r,
              currentB2bPrice: r.newB2bPrice,
              currentCompareAtPrice: r.newCompareAtPrice || null,
              status: "saved",
            };
          })
        );
      }
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  // ---- Handlers ----

  const updateRow = useCallback(
    (
      variantId: string,
      field: "newB2bPrice" | "newCompareAtPrice",
      value: string
    ) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.variantId !== variantId) return r;

          if (field === "newB2bPrice") {
            const error = validatePrice(value);
            const changed = hasChanged(value, r.currentB2bPrice, r.shopifyPrice);
            return {
              ...r,
              newB2bPrice: value,
              validationError: error,
              status: changed ? "modified" : "unchanged",
            };
          }

          if (field === "newCompareAtPrice") {
            const error = value
              ? validatePrice(value, { allowEmpty: true })
              : null;
            return {
              ...r,
              newCompareAtPrice: value,
              compareAtError: error,
              status: "modified",
            };
          }

          return r;
        })
      );
    },
    []
  );

  const resetRow = useCallback((variantId: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.variantId !== variantId) return r;
        return {
          ...r,
          newB2bPrice: r.currentB2bPrice ?? r.shopifyPrice,
          newCompareAtPrice: r.currentCompareAtPrice ?? "",
          status: "unchanged",
          validationError: null,
          compareAtError: null,
        };
      })
    );
  }, []);

  const resetAll = useCallback(() => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        newB2bPrice: r.currentB2bPrice ?? r.shopifyPrice,
        newCompareAtPrice: r.currentCompareAtPrice ?? "",
        status: "unchanged",
        validationError: null,
        compareAtError: null,
      }))
    );
    setSelectedIds(new Set());
  }, []);

  const applyBulkAction = useCallback(
    (
      action:
        | "percent_increase"
        | "percent_decrease"
        | "round_90"
        | "round_99"
        | "reset"
    ) => {
      const pct = parseFloat(bulkPercent) || 0;

      setRows((prev) =>
        prev.map((r) => {
          if (!selectedIds.has(r.variantId)) return r;

          if (action === "reset") {
            return {
              ...r,
              newB2bPrice: r.currentB2bPrice ?? r.shopifyPrice,
              newCompareAtPrice: r.currentCompareAtPrice ?? "",
              status: "unchanged",
              validationError: null,
              compareAtError: null,
            };
          }

          let newPrice = r.newB2bPrice;
          if (action === "percent_increase") newPrice = applyPercent(newPrice, pct);
          else if (action === "percent_decrease") newPrice = applyPercent(newPrice, -pct);
          else if (action === "round_90") newPrice = roundTo(newPrice, 90);
          else if (action === "round_99") newPrice = roundTo(newPrice, 99);

          return {
            ...r,
            newB2bPrice: newPrice,
            validationError: validatePrice(newPrice),
            status: "modified",
          };
        })
      );

      setBulkMenuOpen(false);
    },
    [selectedIds, bulkPercent]
  );

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredRows.length && filteredRows.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRows.map((r) => r.variantId)));
    }
  }, [selectedIds.size, filteredRows]);

  const handleSaveConfirm = useCallback(() => {
    setShowSaveModal(false);
    setSaveResult(null);

    const payload: SaveActionPayload = {
      priceListId,
      currency: catalog.priceList!.currency,
      catalogId: catalog.id,
      catalogName: catalog.title,
      modifiedRows,
    };

    fetcher.submit(payload as unknown as Parameters<typeof fetcher.submit>[0], {
      method: "POST",
      encType: "application/json",
    });
  }, [modifiedRows, catalog, priceListId, fetcher]);

  // ---- Render tabella ----
  const allSelected =
    filteredRows.length > 0 && selectedIds.size === filteredRows.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const tableRows = filteredRows.map((r) => {
    const isSelected = selectedIds.has(r.variantId);
    const de = diffEuro(r.newB2bPrice, r.shopifyPrice);
    const dp = diffPercent(r.newB2bPrice, r.shopifyPrice);

    return [
      // Checkbox
      <Checkbox
        key={`chk-${r.variantId}`}
        label=""
        labelHidden
        checked={isSelected}
        onChange={() => {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            isSelected ? next.delete(r.variantId) : next.add(r.variantId);
            return next;
          });
        }}
      />,

      // Immagine
      r.imageUrl ? (
        <Thumbnail
          key={`img-${r.variantId}`}
          source={r.imageUrl}
          alt={r.productTitle}
          size="small"
        />
      ) : (
        <Box
          key={`img-${r.variantId}`}
          background="bg-fill-secondary"
          borderRadius="100"
          minWidth="40px"
          minHeight="40px"
        />
      ),

      // Prodotto
      <Text key={`prod-${r.variantId}`} variant="bodySm" as="span">
        {r.productTitle}
      </Text>,

      // Variante
      <Text key={`var-${r.variantId}`} variant="bodySm" tone="subdued" as="span">
        {r.variantTitle}
      </Text>,

      // SKU
      <Text key={`sku-${r.variantId}`} variant="bodySm" tone="subdued" as="span">
        {r.sku || "—"}
      </Text>,

      // Prezzo Shopify (non editabile)
      <Text key={`sp-${r.variantId}`} variant="bodySm" as="span">
        {fmt(r.shopifyPrice)}
      </Text>,

      // Prezzo B2B attuale
      r.currentB2bPrice ? (
        <Text key={`b2b-${r.variantId}`} variant="bodySm" as="span">
          {fmt(r.currentB2bPrice)}
        </Text>
      ) : (
        <Badge key={`b2b-${r.variantId}`} tone="warning">
          Nessuno
        </Badge>
      ),

      // Nuovo prezzo B2B (editabile)
      <div key={`new-${r.variantId}`} style={{ width: 130 }}>
        <TextField
          label=""
          labelHidden
          value={r.newB2bPrice}
          onChange={(v) => updateRow(r.variantId, "newB2bPrice", v)}
          error={r.validationError ?? undefined}
          autoComplete="off"
          prefix="€"
          disabled={isSaving}
        />
      </div>,

      // Compare-at price (editabile, opzionale)
      <div key={`cat-${r.variantId}`} style={{ width: 130 }}>
        <TextField
          label=""
          labelHidden
          value={r.newCompareAtPrice}
          onChange={(v) => updateRow(r.variantId, "newCompareAtPrice", v)}
          error={r.compareAtError ?? undefined}
          autoComplete="off"
          prefix="€"
          placeholder="Opz."
          disabled={isSaving}
        />
      </div>,

      // Diff €
      <Text
        key={`de-${r.variantId}`}
        variant="bodySm"
        tone={
          de !== null && de < 0
            ? "critical"
            : de !== null && de > 0
            ? "success"
            : undefined
        }
        as="span"
      >
        {de !== null ? `${de > 0 ? "+" : ""}${fmt(de)}` : "—"}
      </Text>,

      // Diff %
      <Text
        key={`dp-${r.variantId}`}
        variant="bodySm"
        tone={
          dp !== null && dp < 0
            ? "critical"
            : dp !== null && dp > 0
            ? "success"
            : undefined
        }
        as="span"
      >
        {dp !== null ? `${dp > 0 ? "+" : ""}${dp}%` : "—"}
      </Text>,

      // Stato
      r.status === "modified" ? (
        <Badge key={`st-${r.variantId}`} tone="attention">
          Modificato
        </Badge>
      ) : r.status === "saved" ? (
        <Badge key={`st-${r.variantId}`} tone="success">
          Salvato
        </Badge>
      ) : r.status === "error" ? (
        <Badge key={`st-${r.variantId}`} tone="critical">
          Errore
        </Badge>
      ) : (
        <Badge key={`st-${r.variantId}`}>Invariato</Badge>
      ),

      // Reset singola riga
      r.status === "modified" ? (
        <Button
          key={`rst-${r.variantId}`}
          size="micro"
          onClick={() => resetRow(r.variantId)}
          disabled={isSaving}
        >
          Reset
        </Button>
      ) : (
        <span key={`rst-${r.variantId}`} />
      ),
    ];
  });

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <Page
      title="Modifica prezzi catalogo"
      subtitle={catalog.title}
      secondaryActions={[
        {
          content: "← Cambia catalogo",
          onAction: () => navigate("/app"),
          disabled: isSaving,
        },
        {
          content: "Reset tutto",
          onAction: resetAll,
          disabled: isSaving || modifiedRows.length === 0,
          destructive: true,
        },
      ]}
      primaryAction={{
        content: canSave
          ? `Salva ${modifiedRows.length} modific${modifiedRows.length === 1 ? "a" : "he"}`
          : "Salva modifiche",
        disabled: !canSave || isSaving,
        loading: isSaving,
        onAction: () => setShowSaveModal(true),
      }}
    >
      <Layout>
        {/* Progress bar durante il salvataggio */}
        {isSaving && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <ProgressBar animated size="small" />
                <Text as="p" tone="subdued" alignment="center">
                  Salvataggio in corso — {modifiedRows.length} prezzi B2B in
                  aggiornamento su Shopify...
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Risultato salvataggio */}
        {saveResult && !isSaving && (
          <Layout.Section>
            <Banner
              tone={
                saveResult.errors === 0
                  ? "success"
                  : saveResult.saved > 0
                  ? "warning"
                  : "critical"
              }
              title={
                saveResult.errors === 0
                  ? `✅ ${saveResult.saved} prezzo${saveResult.saved !== 1 ? "i" : ""} B2B aggiornato${saveResult.saved !== 1 ? "i" : ""} con successo`
                  : `⚠️ ${saveResult.saved} salvati, ${saveResult.errors} errori`
              }
              onDismiss={() => setSaveResult(null)}
            >
              <BlockStack gap="100">
                {saveResult.skipped > 0 && (
                  <Text as="p">
                    {saveResult.skipped} righe saltate per errori di
                    validazione
                  </Text>
                )}
                {saveResult.errorDetails.length > 0 && (
                  <>
                    <Text as="p" fontWeight="semibold">
                      Dettaglio errori:
                    </Text>
                    {saveResult.errorDetails.map((e, i) => (
                      <Text key={i} as="p" tone="critical">
                        • {e.sku || e.variantId}: {e.message}
                      </Text>
                    ))}
                  </>
                )}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        {/* Risultato import CSV */}
        {csvResult && (
          <Layout.Section>
            <Banner
              title={`CSV importato: ${csvResult.matched} righe abbinate`}
              tone={
                csvResult.notFound > 0 || csvResult.invalid > 0
                  ? "warning"
                  : "success"
              }
              onDismiss={() => setCsvResult(null)}
            >
              <BlockStack gap="100">
                <Text as="p">
                  {csvResult.imported} righe nel file — {csvResult.matched}{" "}
                  abbinate — {csvResult.notFound} non trovate —{" "}
                  {csvResult.invalid} non valide
                </Text>
                {(csvResult.notFound > 0 || csvResult.invalid > 0) && (
                  <Text as="p" tone="subdued">
                    Le righe abbinate sono state caricate in tabella.
                    Clicca &quot;Salva modifiche&quot; per applicarle.
                  </Text>
                )}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        {/* Toolbar */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="300" align="start" blockAlign="end" wrap>
                {/* Ricerca */}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <TextField
                    label="Cerca"
                    value={search}
                    onChange={setSearch}
                    placeholder="Prodotto, SKU, variante..."
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => setSearch("")}
                  />
                </div>

                {/* Percentuale per bulk */}
                <div style={{ width: 100 }}>
                  <TextField
                    label="% bulk"
                    value={bulkPercent}
                    onChange={setBulkPercent}
                    autoComplete="off"
                    suffix="%"
                    type="number"
                  />
                </div>

                <ButtonGroup>
                  {/* Import CSV */}
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSaving}
                  >
                    📥 Importa CSV
                  </Button>

                  {/* Export CSV */}
                  <Button
                    onClick={() =>
                      exportToCSV(rows, catalog.id, catalog.title, priceListId)
                    }
                    disabled={isSaving}
                  >
                    📤 Esporta CSV
                  </Button>

                  {/* Azioni bulk */}
                  <Popover
                    active={bulkMenuOpen}
                    activator={
                      <Button
                        disclosure
                        onClick={() => setBulkMenuOpen((v) => !v)}
                        disabled={selectedIds.size === 0 || isSaving}
                      >
                        Azioni bulk
                        {selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                      </Button>
                    }
                    onClose={() => setBulkMenuOpen(false)}
                  >
                    <ActionList
                      items={[
                        {
                          content: `➕ Aumenta del ${bulkPercent}%`,
                          onAction: () => applyBulkAction("percent_increase"),
                        },
                        {
                          content: `➖ Diminuisci del ${bulkPercent}%`,
                          onAction: () => applyBulkAction("percent_decrease"),
                        },
                        {
                          content: "🔢 Arrotonda a ,90",
                          onAction: () => applyBulkAction("round_90"),
                        },
                        {
                          content: "🔢 Arrotonda a ,99",
                          onAction: () => applyBulkAction("round_99"),
                        },
                        {
                          content: "↩️ Reset selezionati",
                          destructive: true,
                          onAction: () => applyBulkAction("reset"),
                        },
                      ]}
                    />
                  </Popover>
                </ButtonGroup>
              </InlineStack>

              {/* Seleziona tutti */}
              <InlineStack gap="300" blockAlign="center">
                <Checkbox
                  label={
                    allSelected
                      ? `Deseleziona tutti (${filteredRows.length})`
                      : `Seleziona tutti (${filteredRows.length})`
                  }
                  checked={someSelected ? "indeterminate" : allSelected}
                  onChange={toggleSelectAll}
                />
                {modifiedRows.length > 0 && (
                  <Badge tone="attention">
                    {`${modifiedRows.length} modificat${modifiedRows.length === 1 ? "a" : "e"}`}
                  </Badge>
                )}
                {hasErrors && (
                  <Badge tone="critical">
                    Ci sono errori da correggere
                  </Badge>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Tabella */}
        <Layout.Section>
          <Card padding="0">
            <DataTable
              columnContentTypes={[
                "text", "text", "text", "text", "text",
                "numeric", "numeric", "numeric", "numeric",
                "numeric", "numeric", "text", "text",
              ]}
              headings={[
                "",
                "",
                "Prodotto",
                "Variante",
                "SKU",
                "Prezzo Shopify",
                "B2B Attuale",
                "Nuovo B2B",
                "Compare-at",
                "Diff €",
                "Diff %",
                "Stato",
                "",
              ]}
              rows={tableRows}
              footerContent={
                <Text as="span" tone="subdued">
                  {filteredRows.length} variant{filteredRows.length !== 1 ? "i" : "e"}
                  {search ? ` filtrat${filteredRows.length !== 1 ? "e" : "a"}` : ""}
                  {" · "}
                  {modifiedRows.length} modificat{modifiedRows.length !== 1 ? "e" : "a"}
                  {" · "}
                  Catalogo: {catalog.title}
                  {" · "}
                  Currency: {catalog.priceList?.currency}
                </Text>
              }
            />
          </Card>
        </Layout.Section>
      </Layout>

      {/* Input file nascosto per CSV */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          importFromCSV(file, rows, (updatedRows, result) => {
            setRows(updatedRows);
            setCsvResult(result);
          });
          // Reset input per permettere import dello stesso file
          e.target.value = "";
        }}
      />

      {/* Modale conferma salvataggio */}
      <Modal
        open={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        title="Conferma salvataggio prezzi B2B"
        primaryAction={{
          content: `Salva ${modifiedRows.length} prezzo${modifiedRows.length !== 1 ? "i" : ""}`,
          onAction: handleSaveConfirm,
          disabled: !canSave,
        }}
        secondaryActions={[
          {
            content: "Annulla",
            onAction: () => setShowSaveModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="p">
                <strong>Catalogo:</strong> {catalog.title}
              </Text>
              <Text as="p">
                <strong>Price List:</strong> {catalog.priceList?.name} (
                {catalog.priceList?.currency})
              </Text>
              {catalog.companyLocation && (
                <Text as="p">
                  <strong>Azienda:</strong>{" "}
                  {catalog.companyLocation.company.name} —{" "}
                  {catalog.companyLocation.name}
                </Text>
              )}
              <Text as="p">
                <strong>Prezzi da aggiornare:</strong> {modifiedRows.length}
              </Text>
            </BlockStack>

            <Divider />

            <Banner tone="warning">
              <Text as="p">
                Verranno modificati <strong>esclusivamente</strong> i prezzi
                del catalogo B2B selezionato.
                <br />
                I prezzi standard dei prodotti Shopify{" "}
                <strong>non verranno modificati</strong>.
              </Text>
            </Banner>

            {hasErrors && (
              <Banner tone="critical" title="Errori di validazione">
                <Text as="p">
                  Alcune righe hanno errori. Verranno salvate solo le righe
                  valide ({modifiedRows.filter((r) => !r.validationError).length}{" "}
                  su {modifiedRows.length}).
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
