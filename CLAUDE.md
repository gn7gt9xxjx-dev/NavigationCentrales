# CLAUDE.md

Ce fichier guide Claude Code (claude.ai/code) pour travailler dans ce dépôt.

## Le projet

**Navigation Centrales** : une webapp installable (PWA) qui liste ~584 centrales (barrages, CNPE, etc.) et lance la navigation vers l'une d'elles dans Waze, Google Maps ou Plans, **même sans réseau**. Elle remplace une ancienne page statique (`source/navigation-centrales-original.html`, gardée pour référence).

- En ligne : https://gn7gt9xxjx-dev.github.io/NavigationCentrales/ (GitHub Pages, branche `main`, racine du dépôt)
- Utilisateurs : techniciens en déplacement, souvent sans réseau sur site. iPhone en priorité (installée via Safari → « Sur l'écran d'accueil »), Android compatible.
- Propriétaire : Yannick (francophone). **Toute l'interface, les messages de commit et la doc sont en français.**

## Principes à respecter

- **Aucune étape de build, aucun framework.** HTML/CSS/JS natifs servis tels quels. `package.json` ne sert qu'aux outils de dev (tests, icônes). Ne pas introduire de bundler, TypeScript ou dépendance runtime sans demande explicite.
- **Tout doit marcher hors ligne** : toute ressource utilisée par l'appli est locale (polices dans `fonts/`, Leaflet dans `vendor/`) et listée dans `FILES` de `sw.js`. Seuls la carte (tuiles), la recherche de lieu (Nominatim) et la synchro GitHub nécessitent le réseau, avec un message clair quand il manque.
- **Après toute modification de fichier servi (HTML, CSS, JS, icônes…), incrémenter `VERSION` dans `sw.js`** (format `AAAA-MM-JJ.n`). Sinon les téléphones gardent l'ancienne version en cache. Ajouter tout nouveau fichier à `FILES`.
- Les données (`data/centrales.json`) n'ont **pas** besoin de changement de `VERSION` : l'appli relit la liste partagée à chaque lancement.
- Interface : phrases courtes, à la casse normale (pas de MAJUSCULES pour les libellés), cibles tactiles ≥ 44 px, clair/sombre via `prefers-color-scheme`, `prefers-reduced-motion` respecté.

## Architecture

```
index.html            structure : en-tête, liste, feuille de lancement (#sheet), confirmation (#confirm),
                      écran d'ajout (#editor), réglages (#settings), toast
styles.css            tokens de couleur dans :root (+ variante sombre), police Barlow Semi Condensed
app.js                toute la logique de l'interface (voir sections ci-dessous)
sync.js               module Sync : lecture/écriture de data/centrales.json sur GitHub
sw.js                 service worker : cache-first de tous les fichiers de l'appli
manifest.webmanifest  installation (nom « Centrales », icônes, standalone)
data/centrales.json   LA liste partagée (source de vérité)
icons/icon.svg        icône source ; PNG générés par `npm run icons`
tools/extract.py      régénère data/centrales.json depuis l'ancienne page HTML
tools/render-icons.mjs  SVG → apple-touch-icon.png (180), icon-192.png, icon-512.png
tests/e2e.mjs         test de bout en bout (iPhone + Android simulés, faux GitHub)
```

### app.js (sections repérées par `/* ===== … ===== */`)

- **Utilitaires** : `fold()` normalise un nom caractère par caractère (minuscules, sans accents, ponctuation → espace) en **gardant l'alignement des index** avec le nom d'origine (sert au surlignage). `canon()` rend « saint »/« sainte » équivalents à « st »/« ste ». `APPS` construit les liens de navigation.
- **État** : objet `state` unique (mode, recherche, position, favoris, récents, `pending`, `token`, statut de synchro…). Persistance via `store` (localStorage enveloppé dans try/catch).
- **Rendu** : `render()` reconstruit la liste en HTML (A–Z groupé par lettre + « Récents », « Autour de moi » trié par distance, « Favoris »).
- **Feuille de lancement** : boutons Waze / Google Maps / Plans ; l'appli préférée (dernière utilisée) passe en premier.
- **Liste (base + modifications locales)** : `basePlants` = dernière liste partagée connue ; `plants` = `Sync.applyOps(basePlants, state.pending)`. `addPlant` / `removePlant` ajoutent une opération dans `state.pending` puis `changed()` → sauvegarde, rendu, `scheduleSync()`.
- **Synchronisation** : `syncNow()` envoie les opérations en attente (si code d'édition) ou relit simplement la liste. Retire les opérations envoyées par identité d'objet. Déclenchée au lancement, au retour du réseau, au retour au premier plan (> 1 min), après chaque modification (délai 1,5 s).
- **Réglages** : code d'édition (vérifié par une lecture API), prénom (apparaît dans les commits), mise à jour manuelle.
- **Ajout d'une centrale** : module `Editor` ; Leaflet chargé à la demande depuis `vendor/`, fonds OSM / Esri satellite, recherche Nominatim, `parseCoords()` accepte décimal, virgule décimale, DMS et liens Google Maps/Waze. Alerte si une centrale existe à < 1 km.

### Données et identifiants

- Format de `data/centrales.json` : **une centrale par ligne**, `{"n": "NOM", "lat": 45.1, "lon": 1.9}` + `"r": "La Réunion"|"Guyane"` facultatif. `Sync.serialize()` et `tools/extract.py` produisent exactement ce format (diffs Git lisibles) — les garder identiques.
- Identifiant d'une centrale : `` `${n}|${lat}|${lon}` `` (`Sync.idOf`). Favoris, récents et suppressions s'appuient dessus : modifier le nom ou les coordonnées d'une centrale change son identifiant.
- Plusieurs centrales peuvent avoir le même nom (ex. CASTILLON, REVIN) à des endroits différents.

### Synchronisation (sync.js)

- **Lecture sans code** : `raw.githubusercontent.com/.../main/data/centrales.json`, sinon repli sur `data/centrales.json?fresh=…` du site (fonctionne si le dépôt redevient privé ; le SW laisse passer les requêtes `?fresh`).
- **Lecture/écriture avec code** : API GitHub `contents` (GET pour le `sha`, PUT pour enregistrer = un commit sur `main`). Conflit 409/422 → relecture et nouvel essai (3 fois). Les opérations sont idempotentes.
- **Code d'édition** = jeton GitHub *fine-grained* limité à ce dépôt, permission *Contents : Read and write*. Stocké dans le localStorage du téléphone. **Ne jamais écrire de jeton dans le dépôt, le code ou les tests** (les tests utilisent le faux jeton `good`).
- Sans code : lecture seule, `body:not(.can-edit)` masque `#add` et `#remove`.

## Particularités iOS / Android (à ne pas casser)

- iPhone : liens par schémas d'appli (`waze://`, `comgooglemaps://`, `maps://`) — ils s'ouvrent hors ligne et depuis une PWA en plein écran. Android / ordinateur : liens `https://` classiques, bouton Plans masqué. Détection : `isApple`.
- Sur iOS, l'appli installée et Safari **ne partagent pas** leur stockage : le code d'édition doit être saisi dans l'appli lancée depuis l'icône.
- `apple-touch-icon` doit rester un PNG 180×180 opaque, pleine taille (iOS arrondit lui-même les coins). Pas de favicon SVG (iOS l'affiche réduit).
- `<dialog>` + `showModal()` pour toutes les fenêtres ; les zones sûres sont gérées par `env(safe-area-inset-*)`.

## Commandes

```bash
npm install                 # installe Playwright (outils de dev uniquement)
npm run serve               # sert l'appli sur http://localhost:8765
npm test                    # test de bout en bout (≈ 30 s) ; CHROME=/chemin/chrome si Chromium est préinstallé
npm run icons               # régénère les PNG depuis icons/icon.svg
npm run extract             # régénère data/centrales.json depuis l'ancienne page
```

Dans l'environnement cloud de Claude Code, Chromium est préinstallé : `CHROME=/opt/pw-browsers/chromium npm test` (ne pas lancer `playwright install`).

Vérifier visuellement une modification d'interface : capture Playwright en `devices["iPhone 15 Pro"]`, en clair **et** en sombre (`page.emulateMedia({ colorScheme: "dark" })`).

## Flux de travail Git

- `main` = production (publiée automatiquement par GitHub Pages en 1–2 min).
- Travailler sur une branche, ouvrir une PR, fusionner en squash. Messages de commit en français.
- L'appli elle-même fait des commits sur `main` (« Ajout de X », « Suppression de Y », « Depuis l'appli Centrales (par …) ») : **toujours `git pull` / partir de `origin/main` à jour** avant de modifier `data/centrales.json`.
- Les réglages du dépôt (visibilité, Pages, « About ») ne sont pas modifiables depuis l'environnement cloud de Claude Code : les faire faire par Yannick sur github.com.

## Idées non réalisées (pistes)

- Export / sauvegarde des favoris.
- Modifier une centrale existante (aujourd'hui : supprimer puis ajouter).
- Champ « type » (hydraulique, nucléaire…) pour filtrer la liste.
