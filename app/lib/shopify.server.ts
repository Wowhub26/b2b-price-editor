// ============================================================
// SHOPIFY.SERVER.TS — Configurazione OAuth moderna
// Usa @shopify/shopify-app-remix con Supabase come session storage.
// NON usa token fisso — il token viene salvato dopo l'installazione OAuth.
// ============================================================

import "@shopify/shopify-app-remix/adapters/node";
import {
  AppDistribution,
  shopifyApp,
  LATEST_API_VERSION,
} from "@shopify/shopify-app-remix/server";
import { supabaseSessionStorage } from "./supabase.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: LATEST_API_VERSION,
  scopes: process.env.SCOPES?.split(",") ?? [
    "read_products",
    "write_products",
    "read_publications",
    "write_publications",
  ],
  appUrl: process.env.SHOPIFY_APP_URL!,
  authPathPrefix: "/auth",
  sessionStorage: supabaseSessionStorage,
  distribution: AppDistribution.AppStore, // funziona anche per custom app
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = LATEST_API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = supabaseSessionStorage;

// ============================================================
// HELPER — esegue una GraphQL query/mutazione autenticata
// Da usare nei loader/action delle route, passando il request.
// ============================================================
export async function shopifyGraphQL<T = unknown>(
  request: Request,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(query, { variables });
  const json = await response.json();

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e: { message: string }) => e.message).join("; ");
    throw new Error(`Shopify GraphQL Error: ${messages}`);
  }

  return json.data as T;
}

// ============================================================
// HELPER — pagination automatica
// ============================================================
export async function fetchAllPages<T>(
  queryFn: (
    first: number,
    after: string | null
  ) => Promise<{
    nodes: T[];
    pageInfo: { hasNextPage: boolean; endCursor: string };
  }>,
  pageSize = 50
): Promise<T[]> {
  const allNodes: T[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const result = await queryFn(pageSize, cursor);
    allNodes.push(...result.nodes);
    hasNextPage = result.pageInfo.hasNextPage;
    cursor = result.pageInfo.endCursor;
  }

  return allNodes;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
