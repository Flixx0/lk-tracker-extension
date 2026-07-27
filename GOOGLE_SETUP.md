# Configurer Google Sheets pour LK Tracker

Tu as activé l'API — il reste **4 étapes** dans Google Cloud + **2 étapes** dans l'extension.

## Étape 1 — OAuth consent screen

1. [Google Cloud Console](https://console.cloud.google.com) → ton projet
2. **APIs & Services** → **OAuth consent screen**
3. Type : **External** (ou Internal si compte Workspace)
4. Remplis : nom de l'app (`LK Tracker`), email support
5. **Scopes** → Add scope → `Google Sheets API` → `.../auth/spreadsheets`
6. **Test users** → ajoute ton email Google (obligatoire en mode test)
7. Sauvegarde

## Étape 2 — Charger l'extension pour obtenir l'ID

1. `npm run build`
2. Chrome → `chrome://extensions` → Mode développeur
3. **Charger l'extension non empaquetée** → dossier `dist/`
4. Copie l'**ID de l'extension** (ex: `abcdefghijklmnopqrstuvwxyz123456`)

## Étape 3 — Créer le Client ID OAuth (Chrome Extension)

1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
2. Type d'application : **Chrome Extension** (pas "Web application")
3. **Item ID** : colle l'ID de l'extension (étape 2)
4. Créer → copie le **Client ID** (format `xxxxx.apps.googleusercontent.com`)

## Étape 4 — Mettre le Client ID dans l'extension

Ouvre `manifest.json` et remplace :

```json
"client_id": "REMPLACE_PAR_TON_CLIENT_ID.apps.googleusercontent.com"
```

par ton vrai Client ID.

Puis rebuild :

```bash
npm run build
```

Recharge l'extension dans `chrome://extensions` (bouton ↻).

## Étape 5 — Créer ton Google Sheet

1. [Google Sheets](https://sheets.google.com) → nouveau tableur
2. Note l'URL : `https://docs.google.com/spreadsheets/d/XXXXXXXX/edit`
3. Le nom de l'onglet par défaut est souvent `Sheet1` (vérifie en bas du sheet)

## Étape 6 — Connecter dans le popup

1. Ouvre le popup LK Tracker
2. Colle l'URL ou l'ID du sheet
3. Vérifie le nom d'onglet (`Sheet1` par défaut)
4. Clique **Connecter Google**
5. Autorise l'accès à ton compte Google
6. Active **Sync Sheet**

Les prospects seront ajoutés/mis à jour automatiquement dans le sheet.

## Dépannage

| Erreur | Solution |
|--------|----------|
| `bad client id` | Client ID incorrect ou ID extension ne correspond pas |
| `access_denied` | Ajoute ton email dans Test users (OAuth consent screen) |
| `403` sur le sheet | Le sheet doit être accessible par ton compte Google |
| Onglet introuvable | Vérifie le nom d'onglet (sensible à la casse) |

## ID d'extension stable (optionnel)

En dev, l'ID change si tu supprimes/réinstalle l'extension. Pour un ID fixe, ajoute une `key` dans `manifest.json` — voir [Chrome extension key](https://developer.chrome.com/docs/extensions/reference/manifest/key).
