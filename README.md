# Navigation Centrales

Webapp iPhone (PWA) pour lancer Waze, Google Maps ou Plans vers l'une des 584 centrales, **même sans réseau**.

- S'installe sur l'écran d'accueil avec sa propre icône (pas besoin de compte développeur Apple).
- Tout est mis en cache au premier lancement : l'appli s'ouvre ensuite hors ligne.
- Recherche sans accents, « St » = « Saint ».
- « Autour de moi » classe les centrales par distance (le GPS fonctionne sans réseau).
- Favoris, derniers lancements, appli de navigation préférée mémorisés sur le téléphone.

## Installer sur l'iPhone

1. Ouvrir l'adresse de l'appli dans **Safari** (avec du réseau, une seule fois).
2. Partager → **Sur l'écran d'accueil** → Ajouter.
3. Lancer l'appli depuis l'icône une fois : le point vert « Prête hors ligne » confirme que tout est enregistré.

## Hors réseau : ce qui marche

| Appli | Sans réseau |
|---|---|
| Plans (Apple) | Oui, si la zone est téléchargée (Plans → photo de profil → Cartes hors connexion, iOS 17+) |
| Google Maps | Oui, si la zone est téléchargée (Google Maps → photo de profil → Plans hors connexion) |
| Waze | S'ouvre sur la destination, mais ne calcule pas l'itinéraire sans réseau |

## Modifier la liste des centrales

La liste est dans `data/centrales.json` (une ligne par centrale : nom `n`, latitude `lat`, longitude `lon`, région facultative `r`).
Après chaque modification, **changer `VERSION` dans `sw.js`** pour que les téléphones récupèrent la nouvelle liste au lancement suivant (avec réseau).

`tools/extract.py` régénère la liste à partir de l'ancienne page (`source/navigation-centrales-original.html`).

## Structure

```
index.html            page
styles.css            design (clair / sombre automatique)
app.js                logique
sw.js                 cache hors ligne
manifest.webmanifest  installation
data/centrales.json   les 584 centrales
icons/                icône (SVG source + PNG)
fonts/                Barlow Semi Condensed (licence OFL)
tools/                scripts d'extraction et de génération des icônes
```
