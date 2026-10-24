# Historique des versions

Le numéro est visible dans Réglages → À propos. Il faut l'incrémenter (avec `VERSION` dans `sw.js`) à chaque modification de fichier servi.

## 1.15.2
- **Firefox sur Android** : il n'a pas d'invite d'installation (`beforeinstallprompt`) ; le bandeau « Installer » s'affiche quand même, avec les étapes (menu ⋮ → « Installer »), et la croix « Déjà installée » comme sur iPhone. Les liens Waze / Google Maps passent par `intent:` (paquet de l'appli, page web en secours) : Firefox ouvre par défaut les liens `https://` dans le navigateur, donc sans l'appli et sans réseau.
- **iPhone, autres navigateurs que Safari** (Chrome, Firefox, Edge…) : depuis iOS 16.4, ils savent ajouter l'appli à l'écran d'accueil. L'aide d'installation donne les étapes du navigateur utilisé au lieu de renvoyer vers Safari (Safari seulement si l'option manque).
- Mises à jour : rien à changer, le bandeau « Mettre à jour » (service worker) marche dans tous ces navigateurs.

## 1.15.1
- Réglages (et les autres fiches) : à l'ouverture, le bouton « Fermer » n'est plus entouré. `showModal()` donnait le focus au premier bouton, que Safari entourait ; le focus va maintenant au contenu de la fiche (`tabindex="-1" autofocus`, sans contour), comme pour les nouveautés.

## 1.15.0
- Réglages → **« Petite carte de la fiche »** : Plan, Satellite ou Masquée (clé `sheetMap` du localStorage). Tant que rien n'est choisi, la petite carte garde le fond de la carte « Autour de moi », comme avant. Fiche dans les nouveautés.

## 1.14.2
- Icône des barrages : la roue de turbine trempe dans l'eau. Trois vagues au lieu de deux ; la première passe sur le bas de la roue, qui disparaît dessous.

## 1.14.1
- Icône des barrages (hydraulique) : une roue de turbine vue de dessus (pales incurvées dans leur ceinture) au-dessus de l'eau, comme sur l'ancienne carte Google, au lieu de rayons qui faisaient penser à un soleil sur la mer.

## 1.14.0
- Petite carte de l'emplacement dans **toutes les fiches** (A–Z, « Autour de moi », « Favoris », recherche, récents), plus seulement depuis la carte « Autour de moi ». Toujours masquée sans réseau.

## 1.13.2
- Petite carte de la fiche : les lignes claires entre les morceaux de carte sont vraiment corrigées. Leaflet fusionne les morceaux en `plus-lighter` : leurs bords qui se chevauchent s'additionnent et éclaircissent (et le débord d'un pixel de la 1.13.1 les rendait plus visibles). Fusion normale pour cette carte (sélecteur plus précis que celui de leaflet.css, chargé après), débord d'un pixel conservé.

## 1.13.1
- Suppression d'une centrale : la confirmation dit « Elle sera supprimée de la liste partagée, pour tout le monde. » et le bouton devient « Supprimer pour tous », au-dessus de « Annuler » (l'ancien texte parlait à tort de « ce téléphone »).
- Récents : le bouton de balayage « Supprimer » devient « Effacer », pour ne pas le confondre avec la suppression d'une centrale (il la retire seulement des récents, avec « Annuler » dans le message).
- Petite carte de la fiche (depuis la carte « Autour de moi ») : les morceaux de carte se chevauchent d'un pixel, plus de fine ligne claire entre eux sur iPhone.

## 1.13.0
- **Balayage de toutes les lignes** (A–Z, « Autour de moi », « Favoris », résultats de recherche), plus seulement des récents : bouton « Favori ». « Supprimer » et le balayage à fond restent réservés aux récents (les retirer des récents). Les boutons sont créés au début du geste.
- **Modifier une centrale** (avec le code d'édition) : bouton « Modifier » en balayant la ligne, ou en bas de la fiche. Même écran que l'ajout, rempli : nom, position (carte, coordonnées GPS ou code Google), UP et GEH, informations (champ `note`, affiché en orange). Envoyé comme une opération `edit` (commit « Modification de … ») ; favoris et récents suivent la centrale si son nom ou sa position change. « Annuler » dans le message pour revenir en arrière.
- Écran d'ajout : champ « Informations » (champ `note`, affiché en orange).
- Fiche d'une centrale : UP · GEH sous le nom, avec l'icône du groupe. Ouverte depuis la carte « Autour de moi » : petite carte de l'emplacement (zoom 15, fond Plan ou Satellite comme la carte), masquée sans réseau.
- Réglages → « Nouveautés de chaque version » : toutes les versions, avec les corrections en quelques mots (sans flèche) ; seules les fonctions nouvelles ont une flèche qui ouvre leur fiche.

## 1.12.2
- Android (Chrome 132 ou plus récent) : le fichier de favoris est relié comme sur ordinateur. On choisit une fois où le créer (ou on charge l'existant), puis il est réécrit sur place à chaque favori ajouté ou retiré, sans nouvelle copie dans Téléchargements. Si le navigateur ne le permet pas (ancien Chrome, Firefox…), ou refuse d'écrire dans le fichier choisi, retour au téléchargement comme avant. iPhone : inchangé.

## 1.12.1
- Ordinateur : Waze et Google Maps s'ouvrent dans un nouvel onglet, l'appli reste ouverte dans le sien. Rien ne change sur iPhone et Android.
- Ordinateur (Chrome, Edge) : le fichier de favoris n'est plus téléchargé à nouveau à chaque enregistrement. On choisit une fois où le créer (ou on charge le fichier existant), puis il est réécrit sur place à chaque favori ajouté ou retiré. Le navigateur demande l'autorisation de le modifier une fois par visite (« Autoriser lors de chaque visite » la donne pour de bon). Firefox, Safari et téléphones : inchangé.

## 1.12.0
- Didacticiel au premier lancement : les fiches des nouveautés (sauf celles de l'édition) sont présentées une fois, de « Lancer la navigation » au fichier de favoris, avant la question sur le fichier de favoris. Ensuite, elles restent dans Réglages → « Nouveautés de chaque version ». Sur iPhone, seulement dans l'appli installée (pas dans Safari).

## 1.11.2
- Safari sur iPhone : une croix « Déjà installée » masque le bandeau « Ajouter l'appli à l'écran d'accueil ». Safari ne peut pas savoir que l'appli est déjà installée ; le choix est retenu dans Safari (« Annuler » dans le message le fait revenir).

## 1.11.1
- Nouveautés : la fiche « Les codes Google compris à l'ajout » n'est présentée qu'aux téléphones qui ont le code d'édition. Un code saisi plus tard la fait apparaître à sa première validation (une seule fois). Elle reste visible pour tous dans Réglages → « Nouveautés de chaque version ».

## 1.11.0
- Ajout d'une centrale : les codes Google (Plus Codes) sont compris dans « Trouver sur la carte » et « Coordonnées GPS ». Code court avec la commune (« XQ5R+9M Arrens-Marsous », commune cherchée sur Nominatim) ou complet (« 8CJXXQ5R+9M », lu même hors ligne) ; sans commune ou sans réseau, le code est complété d'après la position du téléphone.
- Coordonnées : aussi les degrés-minutes des GPS (« N 45° 6.272' E 1° 57.215' »), les degrés décimaux avec N/E (« 45.10453°N »), les liens Waze encodés (`ll=45.1%2C1.9`) et la position exacte des liens Google Maps vers un lieu (`!3d…!4d…`).

## 1.10.7
- Réglages → À propos : « Nouveautés de chaque version » et « Rechercher une mise à jour » sont espacés, comme les boutons des favoris.
- Les fenêtres (Réglages, fiche d'une centrale…) montent d'un seul bloc à l'ouverture : sur iPhone, les Réglages s'affichaient d'abord à moitié avant de prendre toute la hauteur.

## 1.10.6
- Ajout d'une centrale : l'écran d'ajout n'est plus posé par-dessus la liste, il la remplace le temps de la saisie. Sur iPhone, le clavier s'ouvre et se ferme sans clignotement, et la liste retrouve exactement sa position au retour (elle ne défile plus en cachette).

## 1.10.5
- Ajout d'une centrale : la liste ne défile plus sous l'écran d'ajout quand on le fait glisser (son ascenseur apparaissait sur le côté).

## 1.10.4
- Ajout d'une centrale : toucher le fond de l'écran pendant la saisie ne ferme plus le clavier (l'écran sautait). Pour le fermer : « ✓ » au-dessus du clavier.

## 1.10.3
- Ajout d'une centrale sur iPhone : toucher le fond de l'écran pendant la saisie n'ouvre plus la fiche d'une centrale de la liste cachée dessous, ce qui interrompait la saisie.

## 1.10.2
- Ajout d'une centrale sur iPhone : l'écran suit la zone visible au-dessus du clavier (barre « Annuler / Ajouter » toujours visible, contenu qui défile) et la liste des centrales est masquée pendant la saisie. La correction de la 1.10.1 ne suffisait pas sur iPhone.

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
