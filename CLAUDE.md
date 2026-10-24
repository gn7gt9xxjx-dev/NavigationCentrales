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
- **Après toute modification de fichier servi (HTML, CSS, JS, icônes…), incrémenter `VERSION` dans `sw.js`** (format `AAAA-MM-JJ.n`). Incrémenter aussi `APP_VERSION` (app.js, affiché dans Réglages → À propos, format `x.y.z`) et ajouter une ligne dans `CHANGELOG.md`. Sinon les téléphones gardent l'ancienne version en cache. Ajouter tout nouveau fichier à `FILES`.
- **Numéro de version `x.y.z` (`APP_VERSION`)** : se poser les questions dans l'ordre, la première réponse « oui » décide.
  1. L'utilisateur doit refaire quelque chose (nouveau code d'édition, réinstallation…), l'appli change profondément (refonte des écrans) ou le format de la liste n'est plus lisible par les anciennes versions → **x** (1.13.2 → 2.0.0).
  2. Une nouvelle fonction visible par l'utilisateur, en principe avec sa fiche dans `items` de `NEWS` (pas toujours : bandeau « Installer » en 1.5.0, présentation des nouveautés en 1.9.0, didacticiel en 1.12.0) → **y** (1.13.2 → 1.14.0).
  3. Sinon (correction, texte, couleur, réglage technique ; ligne dans `fixes`) → **z** (1.13.2 → 1.13.3).
  - On remet à zéro les chiffres de droite (1.14.3 → 2.0.0). Une publication qui mélange fonction et corrections prend le plus haut (**y**). Un numéro par publication sur `main`, pas par commit : tant qu'une version n'est pas publiée, on la complète sans changer son numéro. Modifier la liste des centrales (dépôt DataNavigationCentrales) ne change aucun numéro. Un grand **y** (1.25.0) est normal : la v2 est réservée à un vrai changement de cap.
  - `VERSION` (`sw.js`, `AAAA-MM-JJ.n`) change à chaque publication en même temps, quel que soit le chiffre monté.
- **Chaque version a son entrée en tête de `NEWS` (app.js)** : `{ v, date, items, fixes }`. Nouvelle fonction visible par l'utilisateur → une fiche dans `items` (titre, une phrase, les étapes pour s'en servir, + une illustration dans `NEWS_ART` si utile) : présentée une fois après la mise à jour, listée avec une flèche qui l'ouvre. Correction ou changement sans fiche → quelques mots dans `fixes` (listés dans Réglages → Nouveautés, sans flèche, jamais présentés). Le détail reste dans `CHANGELOG.md`.
- La liste partagée vit dans le dépôt séparé **DataNavigationCentrales** (`data/centrales.json`) : pas de changement de `VERSION` pour la modifier, l'appli la relit à chaque lancement. La copie `data/centrales.json` d'ici n'est qu'un secours embarqué : inutile de la tenir à jour.
- Interface : phrases courtes, à la casse normale (pas de MAJUSCULES pour les libellés), cibles tactiles ≥ 44 px, clair/sombre via `prefers-color-scheme`, `prefers-reduced-motion` respecté.

## Architecture

```
index.html            structure : en-tête, liste, feuille de lancement (#sheet), confirmation (#confirm),
                      écran d'ajout (#editor), réglages (#settings), nouveautés (#news, #newsAll),
                      fichier de favoris (#favFile, #favBackup), toast
styles.css            tokens de couleur dans :root (+ variante sombre), police Barlow Semi Condensed
app.js                toute la logique de l'interface (voir sections ci-dessous)
sync.js               module Sync : lecture/écriture de data/centrales.json sur GitHub
sw.js                 service worker : cache-first de tous les fichiers de l'appli
manifest.webmanifest  installation (nom « Centrales », icônes, standalone)
data/centrales.json   copie de secours embarquée (1er lancement hors ligne) ; la source de vérité est le dépôt DataNavigationCentrales
icons/icon.svg        icône source ; PNG générés par `npm run icons`
tools/extract.py      régénère data/centrales.json depuis l'ancienne page HTML
tools/render-icons.mjs  SVG → apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png
CHANGELOG.md          historique des versions (numéro `APP_VERSION`)
tests/e2e.mjs         test de bout en bout (iPhone + Android simulés, faux GitHub)
```

### app.js (sections repérées par `/* ===== … ===== */`)

- **Utilitaires** : `fold()` normalise un nom caractère par caractère (minuscules, sans accents, ponctuation → espace) en **gardant l'alignement des index** avec le nom d'origine (sert au surlignage). `canon()` rend « saint »/« sainte » équivalents à « st »/« ste ». `APPS` construit les liens de navigation.
- **État** : objet `state` unique (mode, recherche, position, favoris, récents, `pending`, `token`, statut de synchro…). Persistance via `store` (localStorage enveloppé dans try/catch).
- **Groupes** : `GROUPS` reprend le classement et les couleurs de l'ancienne carte Google « Centrales EDF » (UP → GEH, CNPE → paliers). `iconOf(p)` dessine l'icône SVG (turbine, tour de refroidissement ou flamme selon le type) à la couleur du GEH ; gris si la centrale n'a pas de groupe connu.
- **Rendu** : `render()` reconstruit la liste en HTML (A–Z groupé par lettre + « Récents », « Autour de moi » trié par distance avec les icônes, « Favoris »). En « Autour de moi », `state.view` choisit Liste ou Carte.
- **Carte « Autour de moi »** : module `NearMap` (Leaflet) : mêmes centrales que la liste (recherche comprise), repères `L.divIcon` avec `iconOf`, position, fond Plan / Satellite, toucher un repère → feuille de lancement. Module `Legend` : une case par UP (masquées : `state.hiddenUps`).
- **Feuille de lancement** : UP · GEH sous le nom (`groupLabel`), boutons Waze / Google Maps / Plans ; l'appli préférée (dernière utilisée) passe en premier ; « Modifier » / « Supprimer » avec le code d'édition. Petite carte de l'emplacement dans toutes les fiches (module `SheetMap`, zoom 15, fond choisi sur la carte « Autour de moi »), masquée hors ligne.
- **Balayage des lignes** : toutes les lignes (`li.swipe`, `.recent` pour les récents) se balaient vers la gauche ; boutons créés au début du geste (`swipeActions`) : « Favori », « Modifier » (code d'édition), « Effacer » (récents seulement : retire des récents ; aussi balayage à fond). « Supprimer » (une centrale, pour tout le monde) n'est que dans la fiche, avec confirmation puis « Annuler ».
- **Liste (base + modifications locales)** : `basePlants` = dernière liste partagée connue ; `plants` = `Sync.applyOps(basePlants, state.pending)`. `addPlant` / `editPlant` / `removePlant` ajoutent une opération (`add`, `edit` = `{id, item}` qui remplace la centrale `id`, `remove`) dans `state.pending` ; `plantItem()` construit la centrale enregistrée ; `editPlant` fait suivre favoris et récents (`moveId`) puis `changed()` → sauvegarde, rendu, `scheduleSync()`.
- **Synchronisation** : `syncNow()` envoie les opérations en attente (si code d'édition) ou relit simplement la liste. Retire les opérations envoyées par identité d'objet. Déclenchée au lancement, au retour du réseau, au retour au premier plan (> 1 min), après chaque modification (délai 1,5 s).
- **Réglages** : code d'édition (vérifié par une lecture API), prénom (apparaît dans les commits), mise à jour manuelle, lien vers la page « Contrôle des positions GPS » (artifact claude.ai, visible seulement avec le code d'édition).
- **Nouveautés** : `NEWS` (une entrée par version, la plus récente en tête : fiches `items` et corrections `fixes`) et `NEWS_ART` (maquettes HTML/CSS animées, figées si `prefers-reduced-motion`). Module `News` : au lancement, `maybeShow()` présente une fois les entrées plus récentes que `newsSeen` (localStorage), en fiches à faire défiler (« Suivant », balayage) ; à la première installation, didacticiel (« Bienvenue ») : toutes les fiches sauf `editors`, de la plus ancienne à la plus récente, une seule fois (sur iPhone seulement dans l'appli installée, pas dans Safari) ; sans `newsSeen` mais avec des données sur le téléphone (version antérieure à cet écran) → depuis la 1.6. `openAll()` : liste par version (Réglages → À propos), fiches avec flèche puis corrections en quelques mots. Fiche `editors: true` (fonction d'édition) : présentée au lancement seulement avec le code d'édition, sinon à la première validation du code (`forEditors()`, `newsEditorsSeen`) ; toujours listée dans `openAll()`.
- **Fichier de favoris** : module `FavFile`. Les favoris (localStorage, perdus si on supprime l'appli) sont aussi enregistrés dans `NavigationCentrales-favoris.json` (une centrale par ligne `{n, lat, lon}`) que l'utilisateur range lui-même : iPhone → `navigator.share` (« Enregistrer dans Fichiers »), sinon téléchargement ; rechargement par `<input type="file">` (les favoris s'ajoutent). Une PWA ne peut ni créer de dossier ni lire/écrire un fichier sans geste de l'utilisateur : `save()` doit être appelé directement depuis un toucher. `favFile` (localStorage) = favoris du dernier fichier. `maybeAsk()` propose de charger ou créer **une seule fois** au premier lancement (`favFileAsked`, après les nouveautés, pas dans Safari sur iPhone) ; ensuite seulement Réglages → Favoris. Différent des favoris actuels → bandeau `#favBackup` et bouton « Enregistrer » dans le message. Chrome/Edge sur ordinateur et Chrome ≥ 132 sur Android (`canLinkFile`, jamais sur iPhone) : `showSaveFilePicker` / `showOpenFilePicker`, le fichier reste relié (handle dans IndexedDB) et `update()` le réécrit sur place à chaque changement de favori quand l'autorisation est déjà donnée pendant la visite ; si l'écriture échoue dans un fichier tout juste choisi, retour au téléchargement.
- **Ajout / modification d'une centrale** : module `Editor` (`open()` : ajout, `open(p)` : modification, champs remplis) ; champs nom, recherche, UP et GEH, informations (`note`), carte, coordonnées ; Leaflet chargé à la demande depuis `vendor/`, fonds OSM / Esri satellite, recherche Nominatim, `parseCoords()` accepte décimal, virgule décimale, DMS et liens Google Maps/Waze. Alerte si une centrale existe à < 1 km.

### Données et identifiants

- Format de `data/centrales.json` : **une centrale par ligne**, `{"n": "NOM", "lat": 45.1, "lon": 1.9}` + `"up": "UP Centre", "geh": "GEH Dordogne"` facultatifs (groupe : icône et couleur, voir `GROUPS`) + `"r": "La Réunion"|"Guyane"` facultatif + `"note": "Emplacement à confirmer"` facultatif (remarque affichée dans la liste et la fiche de navigation). `Sync.serialize()` écrit les champs dans cet ordre et garde à la fin les champs qu'il ne connaît pas ; `tools/extract.py` produit le même format (sans groupe) — garder les deux identiques (diffs Git lisibles).
- Identifiant d'une centrale : `` `${n}|${lat}|${lon}` `` (`Sync.idOf`). Favoris, récents et suppressions s'appuient dessus : modifier le nom ou les coordonnées d'une centrale change son identifiant.
- Plusieurs centrales peuvent avoir le même nom (ex. CASTILLON, REVIN) à des endroits différents.

### Synchronisation (sync.js)

- **Lecture sans code** : `raw.githubusercontent.com/gn7gt9xxjx-dev/DataNavigationCentrales/main/data/centrales.json` (dépôt de données **public**). Hors ligne : dernière liste reçue gardée dans le localStorage (`basePlants`), sinon copie embarquée.
- **Lecture/écriture avec code** : API GitHub `contents` du dépôt de données (GET pour le `sha`, PUT pour enregistrer = un commit sur `main`). Conflit 409/422 → relecture et nouvel essai (3 fois). Les opérations sont idempotentes.
- **Code d'édition** = jeton GitHub *fine-grained* limité au dépôt de données (aucun accès au dépôt de l'appli), permission *Contents : Read and write*. Stocké dans le localStorage du téléphone. **Ne jamais écrire de jeton dans le dépôt, le code ou les tests** (les tests utilisent le faux jeton `good`).
- Sans code : lecture seule, `body:not(.can-edit)` masque `#add` et `#remove`.

## Particularités iOS / Android (à ne pas casser)

- Ordinateur (`isDesktop` : ni Apple, ni Android) : Waze / Google Maps en `target="_blank"` (nouvel onglet). Pas sur téléphone : sur Android le lien `https://` ouvre l'appli Waze/Maps et la page reste en place.
- iPhone : liens par schémas d'appli (`waze://`, `comgooglemaps://`, `maps://`) — ils s'ouvrent hors ligne et depuis une PWA en plein écran. Android / ordinateur : liens `https://` classiques, bouton Plans masqué. Détection : `isApple`.
- Firefox sur Android (`isFirefoxAndroid`) : pas de `beforeinstallprompt` → bandeau « Installer » avec étapes et croix « Déjà installée », comme sur iPhone (`installSteps()` donne les étapes du navigateur : Safari, Chrome, Firefox/Edge sur iPhone, Firefox sur Android). Il ouvre les liens `https://` dans le navigateur par défaut : Waze / Google Maps passent par `intent://…;package=…;S.browser_fallback_url=…` (`androidApp`).
- Android, geste « retour » : retenu par une entrée d'historique (`{guard: true}`, ajoutée dans un `pointerup` : Chrome saute au retour celles ajoutées sans geste). `popstate` ferme la fenêtre du dessus (événement `cancel`, comme Échap) ou la ligne balayée, puis remet l'entrée. Ne jamais quitter l'appli par ce geste.
- Sur iOS, l'appli installée et Safari **ne partagent pas** leur stockage : le code d'édition doit être saisi dans l'appli lancée depuis l'icône.
- Icône « maskable » du manifeste : **fichier à part** (`icon-maskable-512.png`). Firefox (Android) compte deux icônes à la même adresse pour une seule et prendrait la version normale, réduite sur un fond clair.
- `apple-touch-icon` doit rester un PNG 180×180 opaque, pleine taille (iOS arrondit lui-même les coins). Pas de favicon SVG (iOS l'affiche réduit).
- `<dialog>` + `showModal()` pour toutes les fenêtres ; les zones sûres sont gérées par `env(safe-area-inset-*)`.
- **Sauf l'écran d'ajout (`#editor`)** : ouvert par `show()`, il **remplace** l'en-tête et la liste (retirés de la page, position de la liste rendue à la fermeture) au lieu d'être posé dessus. Une fenêtre fixe plein écran au-dessus d'une longue page se comporte mal avec le clavier iOS (liste visible à travers le clavier, touchers et défilement qui atteignent la liste, clignotements). Ne pas revenir à `showModal()` pour lui.

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
- L'appli elle-même fait des commits sur `main` du dépôt de données (« Ajout de X », « Suppression de Y », « Depuis l'appli Centrales (par …) ») : **toujours `git pull` / partir de `origin/main` à jour** avant de modifier `data/centrales.json` **du dépôt DataNavigationCentrales** (et non d'ici).
- Les réglages du dépôt (visibilité, Pages, « About ») ne sont pas modifiables depuis l'environnement cloud de Claude Code : les faire faire par Yannick sur github.com.

## Idées non réalisées (pistes)

- Icônes de groupe aussi dans les listes A–Z et Favoris.
- Filtrer la liste par UP / GEH.
