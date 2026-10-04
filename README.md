# Navigation Centrales

Webapp iPhone (PWA) pour lancer Waze, Google Maps ou Plans vers l'une des 584 centrales, **même sans réseau**.

- S'installe sur l'écran d'accueil avec sa propre icône (pas besoin de compte développeur Apple).
- Tout est mis en cache au premier lancement : l'appli s'ouvre ensuite hors ligne.
- Recherche sans accents, « St » = « Saint ».
- « Autour de moi » classe les centrales par distance (le GPS fonctionne sans réseau).
- Favoris, derniers lancements, appli de navigation préférée mémorisés sur le téléphone.
- **Liste partagée** : la liste vit dans ce dépôt (`data/centrales.json`). Chaque téléphone récupère la dernière version dès qu'il a du réseau, et garde la précédente pour fonctionner hors ligne.
- **Ajouter / supprimer une centrale** (avec un code d'édition) : carte plan ou satellite, recherche de lieu, saisie directe des coordonnées GPS (décimales, degrés-minutes-secondes ou lien Google Maps), alerte si une centrale existe déjà à moins d'1 km, suppression avec confirmation puis « Annuler ». Chaque modification devient un commit dans ce dépôt (historique et retour arrière possibles). Hors réseau, les modifications attendent et partent au retour du réseau.

## Code d'édition

Sans code, l'appli est en lecture seule (pas de bouton + ni Supprimer). Le code d'édition est un jeton GitHub limité à ce dépôt :

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Nom : « Centrales édition » ; Expiration : au choix ; Repository access : **Only select repositories** → `NavigationCentrales`.
3. Permissions → Repository permissions → **Contents : Read and write**. Rien d'autre.
4. Générer, copier le code (commence par `github_pat_`), puis dans l'appli : Réglages → Modifier la liste → coller → Activer.

Donnez ce code uniquement aux personnes qui doivent pouvoir modifier la liste. Pour retirer l'accès à tout le monde : supprimez le jeton sur GitHub et créez-en un nouveau.

## Installer sur l'iPhone

1. Ouvrir l'adresse de l'appli dans **Safari** (avec du réseau, une seule fois).
2. Partager → **Sur l'écran d'accueil** → vérifier que « Ouvrir en tant qu'app web » est activé → Ajouter.
3. Lancer l'appli depuis l'icône : elle s'ouvre en plein écran, sans barre Safari. Le point vert « Prête hors ligne » confirme que tout est enregistré.

## Hors réseau : ce qui marche

| Appli | Sans réseau |
|---|---|
| Plans (Apple) | Oui, si la zone est téléchargée (Plans → photo de profil → Cartes hors connexion, iOS 17+) |
| Google Maps | Oui, si la zone est téléchargée (Google Maps → photo de profil → Plans hors connexion) |
| Waze | S'ouvre sur la destination, mais ne calcule pas l'itinéraire sans réseau |

## Modifier la liste à la main

La liste est dans `data/centrales.json` (une ligne par centrale : nom `n`, latitude `lat`, longitude `lon`, région facultative `r`). Les téléphones récupèrent les changements automatiquement.
Pour une modification du code ou du design, **changer `VERSION` dans `sw.js`** pour que les téléphones téléchargent la nouvelle version.

`tools/extract.py` régénère la liste à partir de l'ancienne page (`source/navigation-centrales-original.html`).

## Structure

```
index.html            page
styles.css            design (clair / sombre automatique)
app.js                logique
sync.js               synchronisation avec le dépôt
sw.js                 cache hors ligne
manifest.webmanifest  installation
data/centrales.json   les 584 centrales
icons/                icône (SVG source + PNG)
fonts/                Barlow Semi Condensed (licence OFL)
vendor/leaflet/       bibliothèque de carte (licence BSD) ; fonds OpenStreetMap et Esri, recherche Nominatim
tools/                scripts d'extraction et de génération des icônes
```
