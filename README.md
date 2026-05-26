# B2B Price Editor — WowHub SRL

App Shopify custom per la modifica bulk dei prezzi B2B tramite cataloghi e price list.

Sviluppata per Shopify Plus con B2B abilitato.

---

## Stack

- **Runtime**: Node.js 20+
- **Framework**: Remix (Shopify App Template)
- **UI**: Shopify Polaris
- **Database**: Supabase (PostgreSQL) — per log operazioni
- **Deploy**: Render
- **API**: Shopify Admin GraphQL API 2026-01

---

## Setup iniziale

### 1. Clona il repo

```bash
git clone https://github.com/wowhub-srl/b2b-price-editor.git
cd b2b-price-editor
npm install
```

### 2. Configura le variabili d'ambiente

```bash
cp .env.example .env
```

Modifica `.env` con i tuoi dati reali:

```env
SHOPIFY_API_KEY=...          # Client ID dal Partners Dashboard
SHOPIFY_API_SECRET=...       # Client Secret dal Partners Dashboard
SHOPIFY_ACCESS_TOKEN=shpat_... # Token generato in Shopify Admin
SHOP=your-store.myshopify.com
SHOPIFY_API_VERSION=2026-01

SUPABASE_URL=https://....supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

SESSION_SECRET=stringa-random-32-caratteri
```

### 3. Setup Supabase

1. Vai su [supabase.com](https://supabase.com) → progetto B2B Price Editor
2. Apri **SQL Editor** → **New query**
3. Incolla il contenuto di `supabase/schema.sql`
4. Clicca **Run**

### 4. Configura `shopify.app.toml`

Sostituisci i placeholder:
- `client_id` → il tuo Client ID dal Partners Dashboard
- `dev_store_url` → il tuo store (.myshopify.com)
- URL di produzione dopo il deploy su Render

### 5. Avvia in locale

```bash
npm run dev
```

L'app si avvia su `http://localhost:3000`.

> **Nota**: in sviluppo locale, Shopify CLI crea un tunnel per esporre l'app.
> Assicurati di essere loggato con `shopify auth login`.

---

## Deploy su Render

1. Pusha il codice su GitHub
2. Su [render.com](https://render.com) → **New Web Service** → connetti repo
3. Impostazioni:
   - **Build Command**: `npm install --include=dev && npm run build`
   - **Start Command**: `npm run start`
   - **Node Version**: `20`
4. Aggiungi tutte le variabili da `.env.example` nella sezione **Environment**
5. Dopo il deploy, copia l'URL e aggiornalo in:
   - `shopify.app.toml` → `application_url` e `redirect_urls`
   - Partners Dashboard → App setup → App URL

---

## Scopes Shopify necessari

```
read_products
write_products
read_publications
write_publications
```

Configurati in `shopify.app.toml` → `[access_scopes]`.

---

## Struttura del progetto

```
app/
├── routes/
│   ├── app.tsx                    # Layout con Frame Polaris
│   ├── app._index.tsx             # Step 1: Selezione catalogo
│   └── app.catalog.$catalogId.tsx # Step 2: Bulk editor
├── lib/
│   ├── shopify.server.ts          # Client GraphQL Shopify
│   ├── supabase.server.ts         # Client Supabase (solo server)
│   ├── batchUtils.ts              # Salvataggio bulk con rate limits
│   ├── priceUtils.ts              # Validazione e calcoli prezzi
│   ├── csvUtils.ts                # Import/export CSV
│   └── graphql/
│       ├── queries.ts             # Query GraphQL
│       └── mutations.ts           # Mutazioni GraphQL
├── types/
│   └── index.ts                   # TypeScript types condivisi
└── root.tsx                       # Root layout Remix

supabase/
└── schema.sql                     # Schema database
```

---

## Flusso dell'app

```
Step 1: Selezione catalogo B2B
  ↓ (click Continua)
Step 2: Bulk editor
  ├── Modifica prezzi manualmente cella per cella
  ├── Importa CSV (preview in tabella — non salva)
  ├── Azioni bulk su selezione multipla
  └── Salva modifiche
        ↓ (conferma modale)
        Shopify: priceListFixedPricesUpdate (chunk da 250)
        Supabase: log operazione
        ↓
        Riepilogo risultati
```

---

## Note importanti

- L'app **non modifica mai** i prezzi standard dei prodotti Shopify
- Agisce **solo** sui prezzi fissi nella price list B2B del catalogo selezionato
- Il salvataggio avviene **solo** dopo conferma esplicita nella modale
- L'import CSV popola la tabella ma **non salva** automaticamente

---

## API Shopify utilizzate

| Operazione | API |
|---|---|
| Lista cataloghi B2B | `catalogs(type: COMPANY_LOCATION)` |
| Dettaglio catalogo | `catalog(id)` |
| Prezzi fissi price list | `priceList.prices` |
| Prodotti e varianti | `products` |
| Aggiornamento prezzi B2B | `priceListFixedPricesUpdate` |

---

## Checklist deploy

```
[ ] .env compilato con tutti i valori
[ ] Supabase: schema.sql eseguito, tabelle visibili
[ ] shopify.app.toml: client_id e URL aggiornati
[ ] Render: deploy riuscito
[ ] Partners Dashboard: URL app aggiornato
[ ] Test: lista cataloghi visibile
[ ] Test: modifica e salvataggio prezzo
[ ] Test: prezzo standard Shopify NON modificato
[ ] Test: log su Supabase (tabella save_logs)
```

---

## Supporto

WowHub SRL — sviluppo interno  
Per problemi con le API Shopify B2B: [shopify.dev/docs/apps/build/b2b](https://shopify.dev/docs/apps/build/b2b)
