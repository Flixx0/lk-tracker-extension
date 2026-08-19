# LK Tracker CMS

Interface de prospection branchée sur la table Supabase `prospects`.

## Local

```bash
cd cms
cp .env.example .env.local
npm install
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000).

## Vercel

1. Importe le repo, **Root Directory** = `cms`
2. Variables d’environnement :
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `CMS_PASSWORD` (recommandé)
3. Deploy

## Relances envoyées

Pour tracker « Relancés » proprement, exécute `supabase-migration.sql` dans l’éditeur SQL Supabase (colonne `follow_up_sent_at`).
