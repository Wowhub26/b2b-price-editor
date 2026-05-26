// ============================================================
// QUERY GRAPHQL — B2B Price Editor
// API Version: 2026-01
//
// ⚠️ VERIFY: Se aggiorni la versione API, ricontrolla i campi:
// - catalogs(type: COMPANY_LOCATION) → enum CatalogType
// - priceList.prices → PriceListPriceConnection
// ============================================================

/**
 * Lista tutti i cataloghi B2B dello store.
 * Filtriamo per type: COMPANY_LOCATION per ottenere solo cataloghi B2B
 * (esclude MarketCatalog e AppCatalog).
 */
export const GET_B2B_CATALOGS = `
  query GetB2BCatalogs($first: Int!, $after: String) {
    catalogs(
      first: $first
      after: $after
      type: COMPANY_LOCATION
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        status
        priceList {
          id
          name
          currency
        }
        ... on CompanyLocationCatalog {
          companyLocation {
            id
            name
            company {
              id
              name
            }
          }
        }
      }
    }
  }
`;

/**
 * Dettaglio di un singolo catalogo per ID.
 */
export const GET_CATALOG_DETAIL = `
  query GetCatalogDetail($id: ID!) {
    catalog(id: $id) {
      id
      title
      status
      priceList {
        id
        name
        currency
      }
      ... on CompanyLocationCatalog {
        companyLocation {
          id
          name
          company {
            id
            name
          }
        }
      }
    }
  }
`;

/**
 * Recupera tutti i prezzi fissi (FIXED) impostati su una price list.
 * Questi sono i prezzi B2B correnti.
 *
 * ⚠️ VERIFY: Il campo 'prices' su PriceList supporta pagination —
 * verificare nella doc che sia PriceListPriceConnection con pageInfo.
 */
export const GET_PRICELIST_PRICES = `
  query GetPriceListPrices($priceListId: ID!, $first: Int!, $after: String) {
    priceList(id: $priceListId) {
      id
      name
      currency
      prices(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          price {
            amount
            currencyCode
          }
          compareAtPrice {
            amount
            currencyCode
          }
          originType
          variant {
            id
            sku
          }
        }
      }
    }
  }
`;

/**
 * Recupera tutti i prodotti attivi con le loro varianti.
 * Usato per costruire la tabella del bulk editor.
 *
 * Nota: se il catalogo ha una publication specifica, idealmente
 * si dovrebbero filtrare solo i prodotti pubblicati in quella publication.
 * Per semplicità e compatibilità, recuperiamo tutti i prodotti attivi.
 *
 * ⚠️ VERIFY: Su store con molti prodotti, valutare di filtrare per
 * publication usando: publication(id: $publicationId) { products { ... } }
 */
export const GET_PRODUCTS_WITH_VARIANTS = `
  query GetProductsWithVariants($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:active") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        vendor
        tags
        featuredImage {
          url
          altText
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            image {
              url
              altText
            }
          }
        }
      }
    }
  }
`;
