#!/bin/bash
# ============================================================
# Script di setup iniziale del repo GitHub
# Esegui una sola volta dopo aver clonato/creato il progetto
# ============================================================

set -e

echo "🚀 Setup B2B Price Editor — WowHub SRL"
echo ""

# 1. Inizializza git se non esiste
if [ ! -d ".git" ]; then
  echo "📁 Inizializzazione repository git..."
  git init
  echo "✅ Git inizializzato"
else
  echo "ℹ️  Repository git già esistente"
fi

# 2. Copia .env.example in .env se non esiste
if [ ! -f ".env" ]; then
  echo "📄 Creazione .env da .env.example..."
  cp .env.example .env
  echo "✅ .env creato — RICORDATI di compilarlo con i tuoi dati!"
else
  echo "ℹ️  .env già esistente"
fi

# 3. Installa dipendenze
echo ""
echo "📦 Installazione dipendenze npm..."
npm install
echo "✅ Dipendenze installate"

# 4. Primo commit
echo ""
echo "📝 Creazione primo commit..."
git add .
git commit -m "feat: initial B2B Price Editor setup

- Shopify Remix app con Polaris UI
- Step 1: selezione catalogo B2B
- Step 2: bulk editor prezzi con import/export CSV
- Supabase: logging operazioni bulk
- Render: configurazione deploy
- Shopify GraphQL API 2026-01" 2>/dev/null || echo "ℹ️  Commit già esistente o nessuna modifica"

echo ""
echo "✅ Setup completato!"
echo ""
echo "Prossimi passi:"
echo "  1. Compila .env con i tuoi dati Shopify e Supabase"
echo "  2. Aggiorna shopify.app.toml con il tuo client_id"
echo "  3. Esegui lo schema SQL su Supabase (supabase/schema.sql)"
echo "  4. Crea il repo su GitHub:"
echo "     git remote add origin https://github.com/wowhub-srl/b2b-price-editor.git"
echo "     git push -u origin main"
echo "  5. Connetti il repo a Render per il deploy automatico"
echo ""
echo "Per avviare in locale:"
echo "  npm run dev"
