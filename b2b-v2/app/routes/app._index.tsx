// ============================================================
// STEP 1 — Selezione catalogo B2B
// Il loader usa authenticate.admin(request) per ottenere
// il client GraphQL autenticato OAuth — nessun token fisso.
// ============================================================

import { useState, useCallback } from "react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import {
  Page, Layout, Card, ResourceList, ResourceItem,
  Text, Badge, Button, TextField, EmptyState, Banner,
  BlockStack, InlineStack, Spinner, Box,
} from "@shopify/polaris";

import shopify, { fetchAllPages } from "~/lib/shopify.server";
import { GET_B2B_CATALOGS } from "~/lib/graphql/queries";
import type { ShopifyCatalog } from "~/types";

// ============================================================
// LOADER
// ============================================================
export async function loader({ request }: LoaderFunctionArgs) {
  // Autentica la richiesta OAuth e ottiene il client GraphQL
  const { admin } = await shopify.authenticate.admin(request);

  try {
    const catalogs = await fetchAllPages<ShopifyCatalog>(
      async (first, after) => {
        const response = await admin.graphql(GET_B2B_CATALOGS, {
          variables: { first, after },
        });
        const json = await response.json();
        return json.data.catalogs;
      },
      50
    );

    return json({ catalogs, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore sconosciuto";
    console.error("[Step1 Loader]", message);
    return json({ catalogs: [] as ShopifyCatalog[], error: message });
  }
}

// ============================================================
// COMPONENT
// ============================================================
export default function Step1SelectCatalog() {
  const { catalogs, error } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);

  const selectedCatalog = catalogs.find((c) => c.id === selectedId);
  const hasPriceList = !!selectedCatalog?.priceList;
  const canContinue = !!selectedId && hasPriceList && !isNavigating;

  const filteredCatalogs = catalogs.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.companyLocation?.company.name.toLowerCase().includes(q) ||
      c.companyLocation?.name.toLowerCase().includes(q) ||
      c.priceList?.name.toLowerCase().includes(q)
    );
  });

  const handleContinue = useCallback(() => {
    if (!selectedId || !hasPriceList) return;
    setIsNavigating(true);
    navigate(`/app/catalog/${encodeURIComponent(selectedId)}`);
  }, [selectedId, hasPriceList, navigate]);

  return (
    <Page
      title="Seleziona catalogo B2B"
      subtitle="Scegli il catalogo B2B di cui vuoi modificare i prezzi in bulk."
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Errore nel caricamento dei cataloghi">
              <p>{error}</p>
              <p>Verifica che l&apos;app sia installata correttamente nello store e che abbia gli scopes necessari.</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <TextField
                label="Cerca catalogo"
                value={search}
                onChange={setSearch}
                placeholder="Nome catalogo, azienda, price list..."
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setSearch("")}
              />

              {!error && catalogs.length === 0 && (
                <EmptyState heading="Nessun catalogo B2B trovato" image="">
                  <p>
                    Assicurati che lo store Shopify Plus abbia cataloghi B2B
                    attivi (CompanyLocationCatalog).
                  </p>
                </EmptyState>
              )}

              {catalogs.length > 0 && filteredCatalogs.length === 0 && (
                <Box padding="400">
                  <Text as="p" tone="subdued" alignment="center">
                    Nessun catalogo trovato per &ldquo;{search}&rdquo;
                  </Text>
                </Box>
              )}

              {filteredCatalogs.length > 0 && (
                <ResourceList
                  resourceName={{ singular: "catalogo", plural: "cataloghi" }}
                  items={filteredCatalogs}
                  selectedItems={selectedId ? [selectedId] : []}
                  onSelectionChange={(ids) => {
                    if (ids === "All") return;
                    const arr = ids as string[];
                    setSelectedId(arr[arr.length - 1] ?? null);
                  }}
                  selectable
                  renderItem={(catalog: ShopifyCatalog) => (
                    <ResourceItem
                      id={catalog.id}
                      onClick={() =>
                        setSelectedId(
                          catalog.id === selectedId ? null : catalog.id
                        )
                      }
                      selected={catalog.id === selectedId}
                    >
                      <InlineStack align="space-between" blockAlign="center" wrap={false}>
                        <BlockStack gap="100">
                          <Text variant="bodyMd" fontWeight="semibold" as="span">
                            {catalog.title}
                          </Text>
                          {catalog.companyLocation && (
                            <Text variant="bodySm" tone="subdued" as="p">
                              🏢 {catalog.companyLocation.company.name} —{" "}
                              {catalog.companyLocation.name}
                            </Text>
                          )}
                          {catalog.priceList ? (
                            <Text variant="bodySm" tone="subdued" as="p">
                              💰 {catalog.priceList.name} ({catalog.priceList.currency})
                            </Text>
                          ) : (
                            <Text variant="bodySm" tone="critical" as="p">
                              ⚠️ Nessuna Price List collegata
                            </Text>
                          )}
                        </BlockStack>
                        <InlineStack gap="200">
                          <Badge
                            tone={
                              catalog.status === "ACTIVE" ? "success"
                              : catalog.status === "DRAFT" ? "attention"
                              : "critical"
                            }
                          >
                            {catalog.status}
                          </Badge>
                          {!catalog.priceList && (
                            <Badge tone="critical">No Price List</Badge>
                          )}
                        </InlineStack>
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {selectedId && !hasPriceList && (
          <Layout.Section>
            <Banner tone="critical" title="Il catalogo non ha una Price List">
              <p>
                Vai in Shopify Admin → B2B → Cataloghi → {selectedCatalog?.title}{" "}
                e associa una Price List prima di continuare.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineStack align="end">
            {isNavigating ? (
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" />
                <Text as="span" tone="subdued">Caricamento...</Text>
              </InlineStack>
            ) : (
              <Button
                variant="primary"
                size="large"
                disabled={!canContinue}
                onClick={handleContinue}
              >
                {selectedId
                  ? `Continua con "${selectedCatalog?.title}"`
                  : "Seleziona un catalogo per continuare"}
              </Button>
            )}
          </InlineStack>
        </Layout.Section>

        {catalogs.length > 0 && (
          <Layout.Section>
            <Text as="p" tone="subdued" alignment="center">
              {catalogs.length} catalog{catalogs.length !== 1 ? "hi" : "o"} B2B
              {filteredCatalogs.length !== catalogs.length &&
                ` — ${filteredCatalogs.length} mostrat${filteredCatalogs.length !== 1 ? "i" : "o"}`}
            </Text>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
