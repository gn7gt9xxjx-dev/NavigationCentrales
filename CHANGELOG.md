# Historique des versions

Le numéro est visible dans Réglages → À propos. Il faut l'incrémenter (avec `VERSION` dans `sw.js`) à chaque modification de fichier servi.

## 1.6.0
- Remarque sur une centrale (champ `note` de la liste partagée, ex. « Emplacement à confirmer ») : affichée dans la liste et dans la fiche de navigation.
- Réglages (avec le code d'édition) : lien vers la page « Contrôle des positions GPS ».

## 1.5.1
- Le nom de l'appli installée devient « Navigation Centrales » (manifeste et titre iOS).

## 1.5.0
- Bandeau « Installer » : sur Android (et Chrome sur ordinateur) il lance l'installation en un geste ; sur iPhone il affiche les étapes (Partager → Sur l'écran d'accueil), car Apple n'autorise pas l'installation automatique. Masqué une fois l'appli installée.

## 1.4.0
- Bandeau « Une nouvelle version est disponible » avec bouton « Mettre à jour » : plus besoin de désinstaller/réinstaller l'appli. Vérification au retour au premier plan, et bouton « Rechercher une mise à jour » dans Réglages.

## 1.3.0
- Ajout de 9 centrales thermiques à flamme d'EDF (CPT Arrighi, Blénod, Bouchain, Brennilis, Cordemais, Dirinon, Gennevilliers, Martigues-Ponteau, Vaires sur Marne). Source : opendata.edf.fr.

## 1.2.0
- La liste partagée vit dans un dépôt séparé, DataNavigationCentrales. Le code d'édition ne donne plus accès qu'à ce dépôt : il faut en saisir un nouveau.
- Affichage du numéro de version dans les Réglages.

## 1.1.x
- Compatibilité Android, nouvelle icône, correctifs iOS.

## 1.0.0
- Première version : liste, lancement Waze / Google Maps / Plans, hors ligne, ajout et suppression de centrales.
