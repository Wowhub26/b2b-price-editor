// ============================================================
// SHOPIFY GRAPHQL CLIENT — Custom App con Access Token fisso
// Nessun OAuth: la custom app usa un token statico dal .env
// ============================================================

const SHOPIFY_GRAPHQL_URL = `https://${process.env.SHOP}/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`;

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: unknown;
    path?: string[];
    extensions?: { code?: string; requestId?: string };
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

/**
 * Esegue una query o mutazione GraphQL contro l'Admin API di Shopify.
 * Usa il token fisso della custom app — nessun OAuth necessario.
 *
 * Lancia un errore in caso di:
 * - HTTP error (4xx, 5xx)
 * - GraphQL errors nel body della risposta
 * - Data null/undefined
 */
export async function shopifyGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(SHOPIFY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  });

  // Controlla HTTP errors
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Shopify API HTTP ${response.status}: ${response.statusText}. ${text}`
    );
  }

  const json: GraphQLResponse<T> = await response.json();

  // Log del costo query (utile per debug rate limits)
  if (json.extensions?.cost) {
    const cost = json.extensions.cost;
    console.log(
      `[Shopify GraphQL] Cost: ${cost.actualQueryCost}/${cost.throttleStatus.maximumAvailable} ` +
        `(available: ${cost.throttleStatus.currentlyAvailable})`
    );
  }

  // Controlla GraphQL errors
  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message).join("; ");
    throw new Error(`Shopify GraphQL Error: ${messages}`);
  }

  if (json.data === undefined || json.data === null) {
    throw new Error("Shopify GraphQL: data è null (risposta vuota)");
  }

  return json.data;
}

/**
 * Pausa l'esecuzione per N millisecondi.
 * Usato per rispettare i rate limits tra chunks di mutazioni.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recupera tutti i nodi di una query paginata, gestendo automaticamente
 * la pagination con cursor.
 *
 * @param queryFn - Funzione che esegue la query con (first, after) → { nodes, pageInfo }
 * @param pageSize - Quanti elementi per pagina (default 50)
 */
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
