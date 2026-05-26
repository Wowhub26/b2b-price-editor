// ============================================================
// STEP 2 — Bulk Editor prezzi B2B
// Usa authenticate.admin(request) per OAuth — nessun token fisso.
// ============================================================

import {
  useState, useCallback, useMemo, useRef, useEffect,
} from "react";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import {
  json, type LoaderFunctionArgs, type ActionFunctionArgs,
} from "@remix-run/node";
import {
  Page, Layout, Card, Button, TextField, Banner, Modal,
  Text, Badge, ButtonGroup, ActionList, Popover, Spinner,
  Thumbnail, Checkbox, Box, InlineStack, BlockStack, DataTable,
  ProgressBar, Divider,
} from "@shopify/polaris";

import shopify, { fetchAllPages } from "~/lib/shopify.server";
import { logSaveOperation } from "~/lib/supabase.server";
import { savePricesInBatches } from "~/lib/batchUtils";
import { exportToCSV, importFromCSV } from "~/lib/csvUtils";
import {
  validatePrice, diffEuro, diffPercent,
  applyPercent, roundTo, fmt, hasChanged,
} from "~/lib/priceUtils";
import {
  GET_CATALOG_DETAIL, GET_PRICELIST_PRICES, GET_PRODUCTS_WITH_VARIANTS,
} from "~/lib/graphql/queries";
import type {
  VariantRow, ShopifyCatalog, BulkSaveResult, CSVImportResult, SaveActionPayload,
} from "~/types";

// ---- Tipi interni ----
interface PriceNode {
  price: { amount: string; currencyCode: string };
  compareAtPrice: { amount: string; currencyCode: string } | null;
  originType: "FIXED" | "RELATIVE";
  variant: { id: string; sku: string };
}
interface ProductNode {
  id: string; title: string; vendor: string;
  featuredImage: { url: string } | null;
  variants: {
    nodes: Array<{
      id: string; title: string; sku: string;
      price: string; compareAtPrice: string | null;
      image: { url: string } | null;
    }>;
  };
}

// ============================================================
// LOADER
// ============================================================
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { admin, session } = await shopify.authenticate.admin(request);
  const catalogId = decodeURIComponent(params.catalogId!);

  // 1. Dettaglio catalogo
  const catalogResp = await admin.graphql(GET_CATALOG_DETAIL, {
    variables: { id: catalogId },
  });
  const catalogJson = await catalogResp.json();
  const catalog: ShopifyCatalog = catalogJson.data.catalog;

  if (!catalog) throw new Response("Catalogo non trovato", { status: 404 });
  if (!catalog.priceList) {
    throw new Response("Il catalogo non ha una Price List collegata", { status: 400 });
  }

  const priceListId = catalog.priceList.id;

  // 2. Prezzi fissi dalla price list
  const priceMap = new Map<string, PriceNode>();
  const priceNodes = await fetchAllPages<PriceNode>(
    async (first, after) => {
      const r = await admin.graphql(GET_PRICELIST_PRICES, {
        variables: { priceListId, first, after },
      });
      const j = await r.json();
      return j.data.priceList.prices;
    },
    250
  );
  for (const node of priceNodes) priceMap.set(node.variant.id, node);

  // 3. Prodotti e varianti
  const productNodes = await fetchAllPages<ProductNode>(
    async (first, after) => {
      const r = await admin.graphql(GET_PRODUCTS_WITH_VARIANTS, {
        variables: { first, after },
      });
      const j = await r.json();
      return j.data.products;
    },
    50
  );

  // 4. Costruisce VariantRow
  const variants: VariantRow[] = [];
  for (const product of productNodes) {
    for (const variant of product.variants.nodes) {
      const b2b = priceMap.get(variant.id);
      variants.push({
        variantId: variant.id,
        productId: product.id,
        productTitle: product.title,
        variantTitle: variant.title,
        sku: variant.sku ?? "",
        imageUrl: variant.image?.url ?? product.featuredImage?.url ?? null,
        shopifyPrice: variant.price,
        shopifyCompareAtPrice: variant.compareAtPrice,
        currentB2bPrice: b2b?.price.amount ?? null,
        currentCompareAtPrice: b2b?.compareAtPrice?.amount ?? null,
        priceOrigin: b2b?.originType ?? "NONE",
        newB2bPrice: b2b?.price.amount ?? variant.price,
        newCompareAtPrice: b2b?.compareAtPrice?.amount ?? "",
        status: "unchanged",
        validationError: null,
        compareAtError: null,
      });
    }
  }

  return json({ catalog, priceListId, variants, shop: session.shop });
}

// ============================================================
// ACTION — Salva prezzi su Shopify + log su Supabase
// ============================================================
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await shopify.authenticate.admin(request);
  const body: SaveActionPayload = await request.json();
  const start = Date.now();

  let result: BulkSaveResult;
  try {
    result = await savePricesInBatches(
      admin,                 // passa il client autenticato OAuth
      body.priceListId,
      body.currency,
      body.modifiedRows
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    return json({
      result: {
        totalModified: body.modifiedRows.length,
        saved: 0, errors: body.modifiedRows.length, skipped: 0,
        errorDetails: [{ variantId: "", sku: "", message }],
      } satisfies BulkSaveResult,
    }, { status: 500 });
  }

  logSaveOperation({
    shop: session.shop,
    catalogId: body.catalogId,
    catalogName: body.catalogName,
    priceListId: body.priceListId,
    result,
    durationMs: Date.now() - start,
  }).catch(console.error);

  return json({ result });
}

// ============================================================
// COMPONENT
// ============================================================
export default function Step2BulkEditor() {
  const { catalog, priceListId, variants: initialVariants } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ result: BulkSaveResult }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevFetcherState = useRef(fetcher.state);

  const [rows, setRows] = useState<VariantRow[]>(initialVariants);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveResult, setSaveResult] = useState<BulkSaveResult | null>(null);
  const [csvResult, setCsvResult] = useState<CSVImportResult | null>(null);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [bulkPercent, setBulkPercent] = useState("10");

  const modifiedRows = useMemo(() => rows.filter((r) => r.status === "modified"), [rows]);
  const hasErrors = useMemo(() => rows.some((r) => r.validationError !== null), [rows]);
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

  useEffect(() => {
    if (
      prevFetcherState.current !== "idle" &&
      fetcher.state === "idle" &&
      fetcher.data?.result
    ) {
      const result = fetcher.data.result;
      setSaveResult(result);
      if (result.saved > 0) {
        setRows((prev) =>
          prev.map((r) =>
            r.status !== "modified" ? r : {
              ...r,
              currentB2bPrice: r.newB2bPrice,
              currentCompareAtPrice: r.newCompareAtPrice || null,
              status: "saved",
            }
          )
        );
      }
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  const updateRow = useCallback(
    (variantId: string, field: "newB2bPrice" | "newCompareAtPrice", value: string) => {
      setRows((prev) =>
        prev.map((r) => {
          if (r.variantId !== variantId) return r;
          if (field === "newB2bPrice") {
            return {
              ...r, newB2bPrice: value,
              validationError: validatePrice(value),
              status: hasChanged(value, r.currentB2bPrice, r.shopifyPrice) ? "modified" : "unchanged",
            };
          }
          return {
            ...r, newCompareAtPrice: value,
            compareAtError: value ? validatePrice(value, { allowEmpty: true }) : null,
            status: "modified",
          };
        })
      );
    }, []
  );

  const resetRow = useCallback((variantId: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.variantId !== variantId ? r : {
          ...r,
          newB2bPrice: r.currentB2bPrice ?? r.shopifyPrice,
          newCompareAtPrice: r.currentCompareAtPrice ?? "",
          status: "unchanged", validationError: null, compareAtError: null,
        }
      )
    );
  }, []);

  const resetAll = useCallback(() => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        newB2bPrice: r.currentB2bPrice ?? r.shopifyPrice,
        newCompareAtPrice: r.currentCompareAtPrice ?? "",
        status: "unchanged", validationError: null, compareAtError: null,
      }))
    );
    setSelectedIds(new Set());
  }, []);

  const applyBulkAction = useCallback(
    (action: "percent_increase" | "percent_decrease" | "round_90" | "round_99" | "reset") => {
      const pct = parseFloat(bulkPercent) || 0;
      setRows((prev) =>
        prev.map((r) => {
          if (!selectedIds.has(r.variantId)) return r;
          if (action === "reset") return {
            ...r, newB2bPrice: r.currentB2bPrice ?? r.shopifyPrice,
            newCompareAtPrice: r.currentCompareAtPrice ?? "",
            status: "unchanged", validationError: null, compareAtError: null,
          };
          let newPrice = r.newB2bPrice;
          if (action === "percent_increase") newPrice = applyPercent(newPrice, pct);
          else if (action === "percent_decrease") newPrice = applyPercent(newPrice, -pct);
          else if (action === "round_90") newPrice = roundTo(newPrice, 90);
          else if (action === "round_99") newPrice = roundTo(newPrice, 99);
          return { ...r, newB2bPrice: newPrice, validationError: validatePrice(newPrice), status: "modified" };
        })
      );
      setBulkMenuOpen(false);
    },
    [selectedIds, bulkPercent]
  );

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(
      selectedIds.size === filteredRows.length && filteredRows.length > 0
        ? new Set()
        : new Set(filteredRows.map((r) => r.variantId))
    );
  }, [selectedIds.size, filteredRows]);

  const handleSaveConfirm = useCallback(() => {
    setShowSaveModal(false);
    setSaveResult(null);
    fetcher.submit(
      { priceListId, currency: catalog.priceList!.currency, catalogId: catalog.id, catalogName: catalog.title, modifiedRows } as unknown as SaveActionPayload,
      { method: "POST", encType: "application/json" }
    );
  }, [modifiedRows, catalog, priceListId, fetcher]);

  const allSelected = filteredRows.length > 0 && selectedIds.size === filteredRows.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const tableRows = filteredRows.map((r) => {
    const isSelected = selectedIds.has(r.variantId);
    const de = diffEuro(r.newB2bPrice, r.shopifyPrice);
    const dp = diffPercent(r.newB2bPrice, r.shopifyPrice);

    return [
      <Checkbox key={`c-${r.variantId}`} label="" labelHidden checked={isSelected}
        onChange={() => setSelectedIds((prev) => { const n = new Set(prev); isSelected ? n.delete(r.variantId) : n.add(r.variantId); return n; })} />,
      r.imageUrl
        ? <Thumbnail key={`i-${r.variantId}`} source={r.imageUrl} alt={r.productTitle} size="small" />
        : <Box key={`i-${r.variantId}`} background="bg-fill-secondary" borderRadius="100" minWidth="40px" minHeight="40px" />,
      <Text key={`p-${r.variantId}`} variant="bodySm" as="span">{r.productTitle}</Text>,
      <Text key={`v-${r.variantId}`} variant="bodySm" tone="subdued" as="span">{r.variantTitle}</Text>,
      <Text key={`s-${r.variantId}`} variant="bodySm" tone="subdued" as="span">{r.sku || "—"}</Text>,
      <Text key={`sp-${r.variantId}`} variant="bodySm" as="span">{fmt(r.shopifyPrice)}</Text>,
      r.currentB2bPrice
        ? <Text key={`b-${r.variantId}`} variant="bodySm" as="span">{fmt(r.currentB2bPrice)}</Text>
        : <Badge key={`b-${r.variantId}`} tone="warning">Nessuno</Badge>,
      <div key={`n-${r.variantId}`} style={{ width: 130 }}>
        <TextField label="" labelHidden value={r.newB2bPrice}
          onChange={(v) => updateRow(r.variantId, "newB2bPrice", v)}
          error={r.validationError ?? undefined} autoComplete="off" prefix="€" disabled={isSaving} />
      </div>,
      <div key={`ca-${r.variantId}`} style={{ width: 130 }}>
        <TextField label="" labelHidden value={r.newCompareAtPrice}
          onChange={(v) => updateRow(r.variantId, "newCompareAtPrice", v)}
          error={r.compareAtError ?? undefined} autoComplete="off" prefix="€" placeholder="Opz." disabled={isSaving} />
      </div>,
      <Text key={`de-${r.variantId}`} variant="bodySm" tone={de !== null && de < 0 ? "critical" : de !== null && de > 0 ? "success" : undefined} as="span">
        {de !== null ? `${de > 0 ? "+" : ""}${fmt(de)}` : "—"}
      </Text>,
      <Text key={`dp-${r.variantId}`} variant="bodySm" tone={dp !== null && dp < 0 ? "critical" : dp !== null && dp > 0 ? "success" : undefined} as="span">
        {dp !== null ? `${dp > 0 ? "+" : ""}${dp}%` : "—"}
      </Text>,
      r.status === "modified" ? <Badge key={`st-${r.variantId}`} tone="attention">Modificato</Badge>
        : r.status === "saved" ? <Badge key={`st-${r.variantId}`} tone="success">Salvato</Badge>
        : r.status === "error" ? <Badge key={`st-${r.variantId}`} tone="critical">Errore</Badge>
        : <Badge key={`st-${r.variantId}`}>Invariato</Badge>,
      r.status === "modified"
        ? <Button key={`r-${r.variantId}`} size="micro" onClick={() => resetRow(r.variantId)} disabled={isSaving}>Reset</Button>
        : <span key={`r-${r.variantId}`} />,
    ];
  });

  return (
    <Page
      title="Modifica prezzi catalogo"
      subtitle={catalog.title}
      secondaryActions={[
        { content: "← Cambia catalogo", onAction: () => navigate("/app"), disabled: isSaving },
        { content: "Reset tutto", onAction: resetAll, disabled: isSaving || modifiedRows.length === 0, destructive: true },
      ]}
      primaryAction={{
        content: canSave ? `Salva ${modifiedRows.length} modific${modifiedRows.length === 1 ? "a" : "he"}` : "Salva modifiche",
        disabled: !canSave || isSaving,
        loading: isSaving,
        onAction: () => setShowSaveModal(true),
      }}
    >
      <Layout>
        {isSaving && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <ProgressBar animated size="small" />
                <Text as="p" tone="subdued" alignment="center">
                  Salvataggio in corso — {modifiedRows.length} prezzi B2B in aggiornamento...
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {saveResult && !isSaving && (
          <Layout.Section>
            <Banner
              tone={saveResult.errors === 0 ? "success" : saveResult.saved > 0 ? "warning" : "critical"}
              title={saveResult.errors === 0
                ? `✅ ${saveResult.saved} prezzi B2B aggiornati`
                : `⚠️ ${saveResult.saved} salvati, ${saveResult.errors} errori`}
              onDismiss={() => setSaveResult(null)}
            >
              <BlockStack gap="100">
                {saveResult.skipped > 0 && <Text as="p">{saveResult.skipped} righe saltate per errori di validazione</Text>}
                {saveResult.errorDetails.map((e, i) => (
                  <Text key={i} as="p" tone="critical">• {e.sku || e.variantId}: {e.message}</Text>
                ))}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        {csvResult && (
          <Layout.Section>
            <Banner
              title={`CSV: ${csvResult.matched} abbinate, ${csvResult.notFound} non trovate, ${csvResult.invalid} non valide`}
              tone={csvResult.notFound > 0 || csvResult.invalid > 0 ? "warning" : "success"}
              onDismiss={() => setCsvResult(null)}
            />
          </Layout.Section>
        )}

        {/* Toolbar */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="300" align="start" blockAlign="end" wrap>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <TextField label="Cerca" value={search} onChange={setSearch}
                    placeholder="Prodotto, SKU, variante..." autoComplete="off"
                    clearButton onClearButtonClick={() => setSearch("")} />
                </div>
                <div style={{ width: 100 }}>
                  <TextField label="% bulk" value={bulkPercent} onChange={setBulkPercent}
                    autoComplete="off" suffix="%" type="number" />
                </div>
                <ButtonGroup>
                  <Button onClick={() => fileInputRef.current?.click()} disabled={isSaving}>📥 Importa CSV</Button>
                  <Button onClick={() => exportToCSV(rows, catalog.id, catalog.title, priceListId)} disabled={isSaving}>📤 Esporta CSV</Button>
                  <Popover
                    active={bulkMenuOpen}
                    activator={
                      <Button disclosure onClick={() => setBulkMenuOpen((v) => !v)} disabled={selectedIds.size === 0 || isSaving}>
                        Azioni bulk{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                      </Button>
                    }
                    onClose={() => setBulkMenuOpen(false)}
                  >
                    <ActionList items={[
                      { content: `➕ Aumenta del ${bulkPercent}%`, onAction: () => applyBulkAction("percent_increase") },
                      { content: `➖ Diminuisci del ${bulkPercent}%`, onAction: () => applyBulkAction("percent_decrease") },
                      { content: "🔢 Arrotonda a ,90", onAction: () => applyBulkAction("round_90") },
                      { content: "🔢 Arrotonda a ,99", onAction: () => applyBulkAction("round_99") },
                      { content: "↩️ Reset selezionati", destructive: true, onAction: () => applyBulkAction("reset") },
                    ]} />
                  </Popover>
                </ButtonGroup>
              </InlineStack>
              <InlineStack gap="300" blockAlign="center">
                <Checkbox label={allSelected ? `Deseleziona tutti (${filteredRows.length})` : `Seleziona tutti (${filteredRows.length})`}
                  checked={allSelected} indeterminate={someSelected} onChange={toggleSelectAll} />
                {modifiedRows.length > 0 && <Badge tone="attention">{modifiedRows.length} modificat{modifiedRows.length === 1 ? "a" : "e"}</Badge>}
                {hasErrors && <Badge tone="critical">Errori da correggere</Badge>}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Tabella */}
        <Layout.Section>
          <Card padding="0">
            <DataTable
              columnContentTypes={["text","text","text","text","text","numeric","numeric","numeric","numeric","numeric","numeric","text","text"]}
              headings={["","","Prodotto","Variante","SKU","Prezzo Shopify","B2B Attuale","Nuovo B2B","Compare-at","Diff €","Diff %","Stato",""]}
              rows={tableRows}
              footerContent={
                <Text as="span" tone="subdued">
                  {filteredRows.length} variant{filteredRows.length !== 1 ? "i" : "e"} · {modifiedRows.length} modificat{modifiedRows.length !== 1 ? "e" : "a"} · {catalog.priceList?.currency}
                </Text>
              }
            />
          </Card>
        </Layout.Section>
      </Layout>

      <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          importFromCSV(file, rows, (updatedRows, result) => { setRows(updatedRows); setCsvResult(result); });
          e.target.value = "";
        }} />

      <Modal
        open={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        title="Conferma salvataggio prezzi B2B"
        primaryAction={{ content: `Salva ${modifiedRows.length} prezzi`, onAction: handleSaveConfirm, disabled: !canSave }}
        secondaryActions={[{ content: "Annulla", onAction: () => setShowSaveModal(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <BlockStack gap="100">
              <Text as="p"><strong>Catalogo:</strong> {catalog.title}</Text>
              <Text as="p"><strong>Price List:</strong> {catalog.priceList?.name} ({catalog.priceList?.currency})</Text>
              {catalog.companyLocation && (
                <Text as="p"><strong>Azienda:</strong> {catalog.companyLocation.company.name} — {catalog.companyLocation.name}</Text>
              )}
              <Text as="p"><strong>Prezzi da aggiornare:</strong> {modifiedRows.length}</Text>
            </BlockStack>
            <Divider />
            <Banner tone="warning">
              <Text as="p">
                Verranno modificati <strong>esclusivamente</strong> i prezzi del catalogo B2B selezionato.
                I prezzi standard dei prodotti Shopify <strong>non verranno modificati</strong>.
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
