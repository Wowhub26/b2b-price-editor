import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import { AppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import it from "@shopify/polaris/locales/it.json";

export default function App() {
  return (
    <html lang="it">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider i18n={it}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  return (
    <html lang="it">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Errore — B2B Price Editor</title>
      </head>
      <body
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "sans-serif",
          color: "#333",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <h1>Si è verificato un errore</h1>
          <p>Ricarica la pagina o contatta il supporto WowHub SRL.</p>
          <a href="/app">← Torna all&apos;app</a>
        </div>
      </body>
    </html>
  );
}
