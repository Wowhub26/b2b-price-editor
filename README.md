# B2B Price Editor — WowHub SRL

App Shopify custom per la modifica bulk dei prezzi B2B.
Usa OAuth moderno (Partners Dashboard) — nessun token fisso.

---

## Stack

- **Remix** + **Node.js 20** + **TypeScript**
- **Shopify Polaris** (UI)
- **@shopify/shopify-app-remix** (OAuth, sessioni, GraphQL)
- **Supabase** (sessioni OAuth + log operazioni)
- **Render** (deploy, piano free)

---

## Come funziona l'autenticazione

A differenza delle legacy app con token fisso, questa app usa **OAuth standard**:

```
1. Merchant apre l'app da Shopify Admin
2. Shopify reindirizza a /auth su Render
3. L'app completa il flow OAuth
4. Il token viene salvato su Supabase (tabella shopify_sessions)
5. Ogni richiesta successiva usa il token salvato
```

Non c'è `SHOPIFY_ACCESS_TOKEN` nel `.env` — il token viene gestito automaticamente.

---

## Setup

### 1. Supabase

1. Crea progetto su [supabase.com](https://supabase.com) → regione **eu-west** (Frankfurt)
2. SQL Editor → incolla `supabase/schema.sql` → **Run**
3. Copia da Settings → API:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (NON la anon key)

### 2. Partners Dashboard

1. [partners.shopify.com](https://partners.shopify.com) → Apps → **B2B Price Editor**
2. API credentials → copia:
   - **Client ID** → `SHOPIFY_API_KEY`
   - **Client secret** → `SHOPIFY_API_SECRET`
3. App setup → **App URL**: `https://b2b-price-editor.onrender.com`
4. **Allowed redirection URLs**: `https://b2b-price-editor.onrender.com/auth/callback`

### 3. Render

1. Push il repo su GitHub
2. render.com → **New Blueprint** → seleziona repo
3. Render legge `render.yaml` e chiede i valori `sync: false`:
   - `SHOPIFY_API_KEY` → Client ID
   - `SHOPIFY_API_SECRET` → Client secret
   - `SHOPIFY_APP_URL` → `https://b2b-price-editor.onrender.com`
   - `SUPABASE_URL` → URL del progetto Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` → service_role key
4. `SESSION_SECRET` viene generato automaticamente da Render

### 4. Installa l'app nello store

1. Partners Dashboard → Apps → B2B Price Editor → **Test on development store** oppure
2. Installa come custom app da: `https://b2b-price-editor.onrender.com?shop=your-store.myshopify.com`

---

## Sviluppo locale

```bash
cp .env.example .env
# Compila .env

npm install
npm run dev
# Shopify CLI avvia un tunnel ngrok automaticamente
```

---

## Struttura

```
app/
├── routes/
│   ├── auth.$.tsx                 # Callback OAuth Shopify
│   ├── app.tsx                    # Layout protetto da OAuth
│   ├── app._index.tsx             # Step 1: selezione catalogo
│   └── app.catalog.$catalogId.tsx # Step 2: bulk editor
├── lib/
│   ├── shopify.server.ts          # Config OAuth + helpers GraphQL
│   ├── supabase.server.ts         # SessionStorage + log operazioni
│   ├── batchUtils.ts              # Salvataggio bulk
│   ├── priceUtils.ts              # Validazione prezzi
│   ├── csvUtils.ts                # Import/export CSV
│   └── graphql/
│       ├── queries.ts
│       └── mutations.ts
└── types/index.ts

supabase/
└── schema.sql                     # Sessioni OAuth + log bulk
render.yaml                        # Deploy automatico Render (free)
```

---

## Variabili d'ambiente

| Variabile | Dove si trova | Obbligatoria |
|---|---|---|
| `SHOPIFY_API_KEY` | Partners Dashboard → Client ID | ✅ |
| `SHOPIFY_API_SECRET` | Partners Dashboard → Client secret | ✅ |
| `SHOPIFY_APP_URL` | URL Render dopo il deploy | ✅ |
| `SCOPES` | Già nel render.yaml | ✅ |
| `SUPABASE_URL` | Supabase → Settings → API | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | ✅ |
| `SESSION_SECRET` | Generato da Render automaticamente | ✅ |

> ⚠️ **Non esiste più `SHOPIFY_ACCESS_TOKEN`** — il token OAuth viene salvato su Supabase dopo l'installazione.

---

## Checklist deploy

```
[ ] Supabase: schema.sql eseguito, tabelle shopify_sessions e save_logs visibili
[ ] Partners Dashboard: App URL e redirect URL aggiornati con URL Render
[ ] Render: Blueprint deployato, tutte le env vars compilate
[ ] App installata nello store (OAuth completato)
[ ] Test: lista cataloghi B2B visibile
[ ] Test: modifica e salvataggio prezzo funzionante
[ ] Test: prezzo standard Shopify NON modificato
[ ] Test: log in Supabase → tabella save_logs
```
