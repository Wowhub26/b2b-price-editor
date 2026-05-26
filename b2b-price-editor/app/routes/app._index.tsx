import { useState, useCallback } from "react";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Badge,
  Button,
  TextField,
  EmptyState,
  Banner,
  BlockStack,
  InlineStack,
  Spinner,
  Box,
} from "@shopify/polaris";
import { shopifyGraphQL, fetchAllPages } from "~/lib/shopify.server";
import { GET_B2B_CATALOGS } from "~/lib/graphql/queries";
import type { ShopifyCatalog } from "~/types";

// ============================================================
// LOADER — Recupera tutti i cataloghi B2B
// ============================================================
export async function loader({ request: _request }: LoaderFunctionArgs) {
  try {
    const catalogs = await fetchAllPages<ShopifyCatalog>(
      async (first, after) => {
        const data = await shopifyGraphQL<{
          catalogs: {
            pageInfo: { hasNextPage: boolean; endCursor: string };
            nodes: ShopifyCatalog[];
          };
        }>(GET_B2B_CATALOGS, { first, after });
        return data.catalogs;
      },
      50 // 50 cataloghi per pagina
    );

    return json({ catalogs, error: null });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore sconosciuto";
    console.error("[Step1 Loader]", message);
    return json({ catalogs: [], error: message });
  }
}

// ============================================================
// COMPONENT — Step 1: Selezione catalogo
// ============================================================
export default function Step1SelectCatalog() {
  const { catalogs, error } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isNavigating, setIsNavigating] = useState(false);

  // Catalogo attualmente selezionato
  const selectedCatalog = catalogs.find((c) => c.id === selectedId);

  // Filtra per ricerca testuale
  const filteredCatalogs = catalogs.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.companyLocation?.company.name.toLowerCase().includes(q) ||
      c.companyLocation?.name.toLowerCase().includes(q) ||
      c.priceList?.name.toLowerCase().includes(q)
    );
  });

  const hasPriceList = !!selectedCatalog?.priceList;
  const canContinue = !!selectedId && hasPriceList && !isNavigating;

  const handleContinue = useCallback(() => {
    if (!selectedId || !hasPriceList) return;
    setIsNavigating(true);
    // Encode per gestire GID con slash e caratteri speciali
    const encoded = encodeURIComponent(selectedId);
    navigate(`/app/catalog/${encoded}`);
  }, [selectedId, hasPriceList, navigate]);

  return (
    <Page
      title="Seleziona catalogo B2B"
      subtitle="Scegli il catalogo B2B di cui vuoi modificare i prezzi in bulk."
    >
      <Layout>
        {/* Errore di caricamento */}
        {error && (
          <Layout.Section>
            <Banner
              tone="critical"
              title="Errore nel caricamento dei cataloghi"
            >
              <p>{error}</p>
              <p>
                Verifica che <code>SHOPIFY_ACCESS_TOKEN</code> e{" "}
                <code>SHOP</code> siano corretti nel file <code>.env</code>.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Lista cataloghi */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {/* Barra di ricerca */}
              <TextField
                label="Cerca catalogo"
                value={search}
                onChange={setSearch}
                placeholder="Nome catalogo, azienda, price list..."
                autoComplete="off"
                clearButton
                onClearButtonClick={() => setSearch("")}
              />

              {/* Stato vuoto */}
              {!error && catalogs.length === 0 && (
                <EmptyState
                  heading="Nessun catalogo B2B trovato"
                  image=""
                >
                  <p>
                    Assicurati che lo store Shopify Plus abbia cataloghi B2B
                    attivi (CompanyLocationCatalog) e che l&apos;app abbia lo
                    scope <code>read_products</code>.
                  </p>
                </EmptyState>
              )}

              {/* Nessun risultato dalla ricerca */}
              {catalogs.length > 0 && filteredCatalogs.length === 0 && (
                <Box padding="400">
                  <Text as="p" tone="subdued" alignment="center">
                    Nessun catalogo trovato per &ldquo;{search}&rdquo;
                  </Text>
                </Box>
              )}

              {/* Lista */}
              {filteredCatalogs.length > 0 && (
                <ResourceList
                  resourceName={{ singular: "catalogo", plural: "cataloghi" }}
                  items={filteredCatalogs}
                  selectedItems={selectedId ? [selectedId] : []}
                  onSelectionChange={(ids) => {
                    if (ids === "All") return;
                    const idArray = ids as string[];
                    setSelectedId(idArray[idArray.length - 1] ?? null);
                  }}
                  selectable
                  renderItem={(catalog: ShopifyCatalog) => {
                    const isSelected = catalog.id === selectedId;
                    const hasPL = !!catalog.priceList;

                    return (
                      <ResourceItem
                        id={catalog.id}
                        onClick={() =>
                          setSelectedId(
                            isSelected ? null : catalog.id
                          )
                        }
                        selected={isSelected}
                      >
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                          wrap={false}
                        >
                          {/* Info catalogo */}
                          <BlockStack gap="100">
                            <Text
                              variant="bodyMd"
                              fontWeight="semibold"
                              as="span"
                            >
                              {catalog.title}
                            </Text>

                            {catalog.companyLocation && (
                              <Text
                                variant="bodySm"
                                tone="subdued"
                                as="p"
                              >
                                🏢 {catalog.companyLocation.company.name}
                                {" — "}
                                {catalog.companyLocation.name}
                              </Text>
                            )}

                            {catalog.priceList ? (
                              <Text variant="bodySm" tone="subdued" as="p">
                                💰 Price List:{" "}
                                <strong>{catalog.priceList.name}</strong>{" "}
                                ({catalog.priceList.currency})
                              </Text>
                            ) : (
                              <Text
                                variant="bodySm"
                                tone="critical"
                                as="p"
                              >
                                ⚠️ Nessuna Price List collegata
                              </Text>
                            )}
                          </BlockStack>

                          {/* Badge stato */}
                          <InlineStack gap="200">
                            <Badge
                              tone={
                                catalog.status === "ACTIVE"
                                  ? "success"
                                  : catalog.status === "DRAFT"
                                  ? "attention"
                                  : "critical"
                              }
                            >
                              {catalog.status}
                            </Badge>
                            {!hasPL && (
                              <Badge tone="critical">No Price List</Badge>
                            )}
                          </InlineStack>
                        </InlineStack>
                      </ResourceItem>
                    );
                  }}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Avviso se catalogo senza price list */}
        {selectedId && !hasPriceList && (
          <Layout.Section>
            <Banner
              tone="critical"
              title="Il catalogo selezionato non ha una Price List"
            >
              <p>
                Per modificare i prezzi B2B, il catalogo deve avere una Price
                List associata. Vai in Shopify Admin → B2B → Cataloghi →{" "}
                {selectedCatalog?.title} e aggiungi una Price List.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Pulsante continua */}
        <Layout.Section>
          <InlineStack align="end">
            {isNavigating ? (
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" />
                <Text as="span" tone="subdued">
                  Caricamento catalogo...
                </Text>
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

        {/* Footer info */}
        {catalogs.length > 0 && (
          <Layout.Section>
            <Text as="p" tone="subdued" alignment="center">
              {catalogs.length} catalogo{catalogs.length !== 1 ? "hi" : ""}{" "}
              B2B trovato{catalogs.length !== 1 ? "i" : ""}
              {filteredCatalogs.length !== catalogs.length &&
                ` — ${filteredCatalogs.length} mostrato${filteredCatalogs.length !== 1 ? "i" : ""}`}
            </Text>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
