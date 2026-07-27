# LK Tracker

Extension Chrome pour tracker les prospects LinkedIn.

## Fonctionnalités (v0.1)

- **Toggle On/Off** — active ou désactive le tracking
- **Profil LinkedIn** — enregistre un prospect quand tu envoies une invitation (nom, lien, photo, poste, statut « invitation envoyée »)
- **Sync connexions** — ouvre tes relations LinkedIn, scroll et met à jour les prospects « invitation envoyée » → « connecté »
- **Messaging** — met à jour le statut + date de message + date de relance quand tu envoies un message
- **Export Excel** — télécharge un fichier `.xlsx` avec tous les prospects

## Stockage

Les données sont stockées localement dans l’extension (`chrome.storage.local`). L’export Excel est le moyen d’obtenir un fichier — l’extension ne peut pas modifier un fichier Excel sur ton disque automatiquement.

## Installation (dev)

```bash
npm install
npm run build
```

1. Ouvre `chrome://extensions`
2. Active « Mode développeur »
3. « Charger l’extension non empaquetée » → sélectionne le dossier `dist/`

## Scripts

- `npm run build` — build production
- `npm run watch` — build avec watch
- `npm run typecheck` — vérification TypeScript

## Limites connues

- Les sélecteurs DOM LinkedIn changent régulièrement — ils peuvent nécessiter des mises à jour
- LinkedIn interdit le scraping dans ses conditions d’usage
- Le sync connexions parse les liens visibles après scroll — pas 100 % exhaustif sur de très longues listes

## Roadmap

- [ ] Backend / vraie DB
- [ ] Import Excel
- [ ] Notifications relance
- [ ] Support Firefox
