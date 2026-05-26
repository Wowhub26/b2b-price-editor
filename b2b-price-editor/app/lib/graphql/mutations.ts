// ============================================================
// MUTAZIONI GRAPHQL — B2B Price Editor
// ============================================================

/**
 * Aggiorna i prezzi fissi di una price list.
 * Supporta sia aggiunta/aggiornamento (toAdd) che rimozione (toDelete).
 *
 * Documentazione: https://shopify.dev/docs/api/admin-graphql/latest/mutations/priceListFixedPricesUpdate
 *
 * Input per ogni prezzo in toAdd:
 * {
 *   variantId: "gid://shopify/ProductVariant/123",
 *   price: { amount: "29.90", currencyCode: "EUR" },
 *   compareAtPrice: { amount: "39.90", currencyCode: "EUR" } // opzionale
 * }
 *
 * IMPORTANTE: Questa mutazione NON modifica i prezzi standard dei prodotti.
 * Modifica solo i prezzi fissi nella price list B2B specificata.
 */
export const PRICE_LIST_FIXED_PRICES_UPDATE = `
  mutation PriceListFixedPricesUpdate(
    $priceListId: ID!
    $toAdd: [PriceListPriceInput!]!
    $toDelete: [ID!]!
  ) {
    priceListFixedPricesUpdate(
      priceListId: $priceListId
      prices: {
        toAdd: $toAdd
        toDelete: $toDelete
      }
    ) {
      priceList {
        id
        name
        currency
      }
      pricesAdded {
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
      deletedFixedPriceVariantIds
      userErrors {
        field
        message
        code
      }
    }
  }
`;
