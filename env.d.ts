/// <reference types="@remix-run/node" />
/// <reference types="vite/client" />

declare module "*.svg" {
  const content: string;
  export default content;
}

// Dichiarazione variabili d'ambiente per TypeScript
declare namespace NodeJS {
  interface ProcessEnv {
    SHOPIFY_API_KEY: string;
    SHOPIFY_API_SECRET: string;
    SHOPIFY_ACCESS_TOKEN: string;
    SHOP: string;
    SHOPIFY_API_VERSION: string;
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
    SESSION_SECRET: string;
    NODE_ENV: "development" | "production" | "test";
  }
}
