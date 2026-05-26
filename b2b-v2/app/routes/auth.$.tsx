// ============================================================
// ROUTE AUTH — Gestisce il flusso OAuth di Shopify
// Shopify reindirizza qui durante l'installazione/login.
// ============================================================

import { type LoaderFunctionArgs } from "@remix-run/node";
import { login } from "~/lib/shopify.server";
import shopify from "~/lib/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Gestisce la callback OAuth di Shopify
  // Salva il token su Supabase tramite supabaseSessionStorage
  await shopify.authenticate.admin(request);

  return null;
}

// Questa route non renderizza nulla —
// authenticate.admin() fa redirect automaticamente
