// ============================================================
// APP LAYOUT — Protegge tutte le route /app/* con OAuth
// ============================================================

import { type LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLoaderData } from "@remix-run/react";
import { AppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import "@shopify/polaris/build/esm/styles.css";
import it from "@shopify/polaris/locales/it.json";
import { boundary } from "@shopify/shopify-app-remix/server";
import { Frame } from "@shopify/polaris";

import shopify from "~/lib/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // authenticate.admin() verifica la sessione OAuth.
  // Se non autenticato, fa redirect al login Shopify automaticamente.
  await shopify.authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY! };
}

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider i18n={it}>
      <Frame>
        <Outlet />
      </Frame>
    </AppProvider>
  );
}

// Necessario per il corretto funzionamento embedded in Shopify Admin
export function ErrorBoundary() {
  return boundary.error();
}

export const headers = boundary.headers;
