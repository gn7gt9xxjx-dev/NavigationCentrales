# Historique des versions

Le numéro est visible dans Réglages → À propos. Il faut l'incrémenter (avec `VERSION` dans `sw.js`) à chaque modification de fichier servi.

## 1.10.1
- Ajout d'une centrale sur iPhone : la liste des centrales n'apparaît plus derrière le clavier pendant la saisie (coordonnées GPS, nom…).

## 1.10.0
- **Fichier de favoris** : les favoris peuvent être enregistrés dans un fichier `NavigationCentrales-favoris.json` (iPhone : menu Partager → « Enregistrer dans Fichiers », de préférence dans iCloud Drive, dossier « NavigationCentrales » ; Android : Téléchargements) et rechargés après une réinstallation ou sur un nouveau téléphone. Les favoris du fichier s'ajoutent à ceux du téléphone.
- Au premier lancement (installation, ou mise à jour depuis une version précédente) : « Oui, charger mon fichier » / « Non, créer le fichier » / « Plus tard ». La question n'est posée qu'une fois ; « Plus tard » rappelle qu'on peut le faire dans Réglages → Favoris. Pas dans Safari sur iPhone, seulement dans l'appli installée.
- Après l'ajout ou le retrait d'un favori : bouton « Enregistrer » dans le message, et bandeau « Le fichier de favoris n'est plus à jour » tant qu'il ne l'est pas.
- Réglages → Favoris : état du fichier, « Enregistrer le fichier de favoris », « Charger un fichier de favoris ».
- Une appli web ne peut pas créer seule de dossier (avec son icône) dans Fichiers, ni lire ou écrire un fichier sans que l'utilisateur le choisisse : c'est réservé aux applis de l'App Store / du Play Store.

## 1.9.0
- **Nouveautés** : juste après une mise à jour, une présentation pas à pas (illustrée) montre les nouvelles fonctions et comment s'en servir. Elle ne s'affiche qu'une fois ; « Passer » la ferme. Rien n'est affiché à la première installation.
- Réglages → À propos → « Nouveautés de chaque version » : la liste des nouvelles fonctions par version ; toucher une ligne rouvre son explication.
- Les fenêtres plus hautes que l'écran (Réglages sur un petit téléphone) défilent.

## 1.8.1
- Couleurs des icônes identiques à l'ancienne carte « Centrales EDF » (relevées sur ses icônes), y compris CP2, N4, GEH Lot Truyère, GEH Ouest, GEH Inconnu et GEH Tarn Agout.

## 1.8.0
- « Autour de moi » : choix **Liste** ou **Carte**. La carte montre les mêmes centrales que la liste (recherche comprise), à leurs coordonnées GPS ; toucher une centrale ouvre la fiche de navigation. Fond Plan ou Satellite, bouton pour se recentrer, noms affichés en zoomant. Sans réseau, le fond de carte manque mais les centrales et la position restent affichées.
- Icônes colorées comme sur l'ancienne carte Google « Centrales EDF » : turbine pour l'hydraulique, tour de refroidissement pour les CNPE, flamme pour le thermique, couleur du GEH (ou du palier). Dans la liste « Autour de moi » et sur la carte.
- Sites EDF qui ne sont pas des centrales (bureaux, R&D) : icône de bâtiment.
- Légende de la carte : les UP et leurs GEH, avec une case pour masquer une UP.
- Liste partagée : nouveaux champs facultatifs `up` et `geh` ; l'écran d'ajout propose le groupe de la centrale la plus proche. Les champs inconnus de la liste sont désormais conservés lors d'un envoi.

## 1.7.2
- Bandeau « Une nouvelle version est disponible » : le numéro de la nouvelle version est indiqué entre parenthèses.
- Juste après une mise à jour, l'appli ne lit plus que les fichiers de la nouvelle version (l'ancien cache pouvait encore servir un instant).

## 1.7.1
- Les données du téléphone (code d'édition, favoris, récents, liste) se conservent mieux : l'appli demande un stockage persistant, qui n'est plus vidé quand la place manque.
- Réglages : rappel que supprimer l'icône de l'appli efface le code d'édition.

## 1.7.0
- Récents : balayer une centrale vers la gauche (comme sur l'iPhone). À moitié : boutons « Favori » (jaune) et « Supprimer » (rouge) ; à fond : retirée des récents directement. Elle reste dans les favoris si elle y est. « Annuler » dans le message pour la remettre.

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
