import { Outlet } from "@remix-run/react";
import { Frame } from "@shopify/polaris";

/**
 * Layout principale dell'app.
 * Wrappa tutte le route /app/* con il Frame di Polaris.
 * In produzione, qui andrà anche il setup di App Bridge per l'embedding in Shopify Admin.
 */
export default function AppLayout() {
  return (
    <Frame>
      <Outlet />
    </Frame>
  );
}
