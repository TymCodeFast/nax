# NaX

Navigateur **open source** basé sur Chromium (Electron). Objectif : repenser onglets et
favoris pour qu'ils s'organisent tout seuls, pas refaire un navigateur complet. Licence MIT.

> Avant de publier : remplacer `OWNER` par le compte GitHub qui héberge le dépôt, dans
> `package.json` (`homepage`, `repository`, et `build.publish[0].owner`). C'est ce compte
> qui pilote les mises à jour automatiques.

## Lancer

    npm start

## Principe : organiser après, jamais avant

- **Applis en boutons** (rail gauche) : Gmail, Agenda, Drive par défaut. Instance unique,
  jamais dans la liste des onglets. `+` pour ajouter un site, clic droit pour retirer.
  **Aperçu au survol** : rester sur une icône ouvre un petit panneau flottant (fenêtre enfant
  sans cadre, `ui/peek.html` + `peek-preload.js`), qui reste tant que la souris est dessus,
  avec un bouton pour ouvrir en grand.
  - **Gmail** a un widget maison (pas un webview) : liste des mails non lus (expéditeur,
    objet, extrait, heure) récupérée via le flux Atom `mail.google.com/mail/feed/atom` avec
    la session déjà connectée (aucun OAuth). Clic sur un mail l'ouvre dans Gmail. Une pastille
    de compteur s'affiche sur l'icône du rail (sondage toutes les 3 min). Si non connecté, le
    widget invite à ouvrir Gmail.
  - Les autres applis (Agenda, Drive…) n'ont pas d'aperçu au survol : elles s'ouvrent au clic. Google Agenda n'expose pas de flux lisible via la session, donc pas de widget maison sans OAuth.
- **Îlots automatiques** : une page ouverte depuis une autre (Ctrl+clic, `target=_blank`,
  clic droit → nouvel onglet) reste collée à son ouvreur. Le titre du groupe est déduit
  (requête Google, sinon titre de la 1re page). Double-clic pour renommer.
  **Groupes repliables** : clic sur le chevron ou le nom du groupe le réduit à une seule
  barre (nom, aperçu des favicons empilés, compteur) ; re-clic pour déplier. État mémorisé.
- **Dédoublonnage** : taper l'adresse d'une page déjà ouverte y ramène au lieu d'en ouvrir
  une 2e. Marche aussi pour un simple domaine (`jira.exemple.fr`) et une recherche Google
  identique. Ctrl+Entrée force un nouvel onglet.
- **Veille automatique** : un onglet non touché depuis 2 h est déchargé et passe dans la
  section « en veille » (grisée). Un clic le réveille.
- **Archive** : un onglet fermé, ou en veille depuis 3 jours, part dans l'archive. Rien ne
  se perd, tout se retrouve.
- **Recherche partout** (Ctrl+K) : onglets ouverts, en veille, archive, historique.

## Organisation manuelle (glisser-déposer)

En plus des îlots automatiques, tout se réorganise à la souris dans la liste des onglets.

- **Réordonner** : glisser un onglet, une ligne indique où il tombera.
- **Grouper** : déposer un onglet sur le centre d'un autre onglet isolé les réunit en groupe
  (l'onglet cible s'entoure de cyan).
- **Ajouter à un groupe** : déposer un onglet sur un groupe existant (le groupe s'entoure de
  violet), ou entre deux onglets du groupe.
- **Dégrouper** : glisser un onglet hors de son groupe, sur une frontière entre groupes
  (ligne grise = onglet isolé).
- **Déplacer un groupe entier** : glisser son en-tête.

Un menu contextuel (clic droit) reste disponible : mettre en veille, dupliquer, renommer le
groupe, sortir du groupe, fermer. L'invariant « un groupe reste d'un seul tenant » est
maintenu automatiquement après chaque déplacement. Le glisser ne concerne que les onglets
actifs, pas la section en veille.

## Fenêtre sans cadre

Pas de barre de titre système : le haut de l'interface fait office de header, façon Chrome.
Les boutons réduire / agrandir / fermer restent natifs, superposés en haut à droite via
`titleBarStyle: 'hidden'` + `titleBarOverlay` (couleurs suivant le thème). La barre de
navigation, l'en-tête de la liste et le rail sont des zones de déplacement
(`-webkit-app-region: drag`), les contrôles interactifs étant en `no-drag`. Un espace est
réservé à droite de la barre de nav pour ne pas passer sous les boutons système.

## Paramètres

Bouton engrenage (rail en bas, aussi accessible en bas de la liste). Panneau avec une
navigation à gauche, pensé pour s'étoffer. Volets actuels :

- **Apparence** : thème Système / Clair / Sombre. Piloté par `nativeTheme.themeSource` côté
  main ; Chromium force alors `prefers-color-scheme` partout (interface et pages web) et le
  CSS bascule via sa media query, sans rechargement. Le thème clair est un jeu de tokens
  dans `@media (prefers-color-scheme: light)` de `style.css`. Choix mémorisé.
- **Mots de passe** : le coffre (voir ci-dessous) vit maintenant ici.
- **Recherche** : choix du moteur de recherche (Google, DuckDuckGo, Bing, Qwant, Ecosia, Brave, Startpage). Il pilote la barre d'adresse (Entrée) et les suggestions. Réglage mémorisé.
- **Développeur** : un interrupteur « Mode développeur ». Quand il est actif, le navigateur
  détecte les serveurs de dev qui tournent en local et les affiche dans une 2e section du
  rail (sous les applis), prêts à ouvrir. Détection : `netstat` liste les ports en écoute
  (2000–9999), puis une sonde HTTP (timeout 1,8 s, tolère les démarrages à froid) ne garde
  que ceux qui servent une page front — HTML au root, ou une redirection qu'elle suit, en
  écartant les API JSON — et récupère le `<title>` comme nom. Re-scan toutes les 4 s, donc
  un projet lancé apparaît seul et disparaît à l'arrêt. Clic sur une tuile = ouvre le projet
  (focus l'onglet s'il est déjà ouvert). Le volet liste aussi les projets détectés. Réglage
  mémorisé.

Pour ajouter un réglage : un `.settings-navitem` dans la nav, une `.settings-pane` dans le
contenu (`ui/index.html`), et le câblage dans `ui/app.js`.

## Favoris

Gestionnaire complet en arbre (liens + dossiers + sous-dossiers), dans la section « Favoris »
repliable de la liste. Modèle de données : un arbre de nœuds `{id, type:'link'|'folder',
title, url?, favicon?, children?, collapsed?}`, persisté dans `state.json`.

- **Marquer une page** : l'étoile de la barre d'adresse (dorée si en favori), Ctrl+D, ou
  clic droit sur un onglet → Ajouter aux favoris (ajouté à la racine).
- **Dossiers** : bouton dossier+ dans l'en-tête Favoris (nouveau dossier à la racine), ou
  clic droit sur un dossier → Nouveau sous-dossier. Clic sur un dossier = plier/déplier
  (état mémorisé dans l'arbre).
- **Glisser-déposer** : réordonner, déposer sur un dossier pour y entrer (surbrillance
  dorée), déposer entre deux lignes pour placer à ce niveau (ligne indentée selon la
  profondeur). Les cycles sont interdits (un dossier ne peut pas entrer dans lui-même).
- **Renommer** : double-clic sur le titre, ou clic droit. **Supprimer** : croix au survol,
  ou clic droit (supprime le sous-arbre).
- **Ouvrir** : clic sur un lien (onglet courant, dédoublonné), clic du milieu (nouvel
  onglet), clic droit sur un dossier → Ouvrir tous les liens.
- **Palette Ctrl+K** : les liens favoris apparaissent dans une section dédiée.

Complément possible plus tard : une vue « Récurrents » calculée depuis l'historique.

## Mots de passe

Coffre local dans le bouton « Mots de passe » de la liste. Chiffré au repos par le coffre
Windows (DPAPI via `safeStorage`), donc jamais en clair sur le disque.

Import depuis Chrome par CSV, seule voie fiable : depuis Chrome 127 la clé de chiffrement
est liée à l'exécutable Chrome (app-bound encryption), ce qui bloque volontairement toute
lecture directe du fichier `Login Data`. Étapes :

1. Dans Chrome : `chrome://password-manager/passwords`, Paramètres, « Exporter les mots de passe ».
2. Chrome demande le code Windows puis produit un `.csv`.
3. Dans l'app : Mots de passe → Importer depuis Chrome → choisir le fichier.
4. Supprimer le CSV (il est en clair).

L'import dédoublonne par site + identifiant. Chaque entrée peut être révélée, copiée
(le presse-papiers est effacé 30 s après), ouverte, ou supprimée. Stocké chiffré dans
`%APPDATA%/browser/passwords.enc`.

Le remplissage automatique des formulaires web n'est pas encore fait ; c'est la suite
logique.

## Raccourcis

| Touche | Action |
|---|---|
| Ctrl+T / Ctrl+W | nouvel onglet / fermer |
| Ctrl+Shift+N | nouvel onglet privé |
| Ctrl+Shift+T | rouvrir le dernier fermé |
| Ctrl+L / Alt+D / F6 | barre d'adresse |
| Ctrl+K | rechercher partout |
| Ctrl+B | replier la liste des onglets |
| Ctrl+Tab | dernier onglet utilisé (bascule) |
| Ctrl+Shift+Tab | onglet précédent (ordre de la liste) |
| Ctrl+PgSuiv / Ctrl+PgPréc | onglet suivant / précédent (ordre de la liste) |
| Ctrl+1 … Ctrl+8 / Ctrl+9 | n-ième onglet / dernier onglet |
| Alt+← / Alt+→, boutons latéraux de la souris | précédent / suivant |
| Alt+Début | page d'accueil |
| Ctrl+R, F5 / Ctrl+Shift+R, Ctrl+F5, Maj+F5 | recharger / recharger sans le cache |
| Ctrl+F | rechercher dans la page |
| Ctrl+D | ajouter/retirer des favoris |
| Ctrl+H / Ctrl+J | historique / téléchargements |
| Ctrl+Shift+Suppr | effacer les données de navigation |
| Ctrl+S / Ctrl+P | enregistrer la page / imprimer |
| Ctrl+U | code source de la page |
| Ctrl+= / Ctrl+- / Ctrl+0 | zoom |
| F11 | plein écran |
| F12 / Ctrl+Shift+I | devtools page / devtools interface |

## Structure

- `main.js` : process principal. Une `BaseWindow`, une vue « chrome » (interface) qui
  couvre la fenêtre, et une seule vue de contenu (onglet ou appli) posée par-dessus dans
  la zone principale. Modèle des onglets, groupes, applis, archive, historique, veille.
- `preload.js` : pont IPC exposé à l'interface (`window.api`).
- `ui/index.html`, `ui/style.css`, `ui/app.js` : rail d'applis, liste d'onglets, barre de
  navigation, palette, archive.
- État persisté dans `%APPDATA%/browser/state.json` (onglets, groupes, applis, archive,
  historique).

## Réglages (constantes en tête de main.js)

`DORMANT_AFTER` (2 h), `ARCHIVE_AFTER` (3 j), `HOME`, `DEFAULT_APPS`, largeurs des colonnes.

## Pistes suivantes

- Pastilles de notification sur les applis (mails non lus, événement proche).
- Vue « récurrents » : pages où l'on revient souvent, calculée depuis l'historique
  (remplace les favoris).
- Touche « à lire » / « à faire » qui sort une page du navigateur vers l'outil de tâches.
- Applis en panneau latéral (façon Messenger d'Opera) en plus du plein écran.
- Glisser-déposer pour réordonner ou regrouper à la main.

## Installer NaX (application Windows)

Prérequis de build : `npm install` (une fois).

1. Construire l'installeur :

        npm run dist

   Résultat : `dist/NaX Setup 0.1.0.exe` (installeur NSIS) et `dist/win-unpacked/NaX.exe`
   (version décompressée, lançable telle quelle).

2. Installer : double-clic sur `NaX Setup 0.1.0.exe`. Choix du dossier, raccourcis menu
   Démarrer et bureau créés. L'app n'est pas signée, donc Windows SmartScreen peut avertir :
   « Informations complémentaires » puis « Exécuter quand même ».

3. Lancer NaX depuis le menu Démarrer ou le bureau.

**Données** : favoris, mots de passe, réglages et onglets vivent dans `%APPDATA%/NaX`,
le même dossier en dev (`npm start`) et une fois installé. Elles suivent donc
automatiquement, et une désinstallation ne les efface pas.

Rebuild après une modif du code : relancer `npm run dist`.

## Mises à jour automatiques (open source, via GitHub Releases)

Une fois installé, NaX vérifie au démarrage (puis toutes les 6 h) s'il existe une version
plus récente publiée dans les Releases du dépôt GitHub. Si oui, il la télécharge et propose
de redémarrer pour l'appliquer. Le dépôt étant public, aucune authentification n'est requise
côté utilisateur. Rien de tout cela ne s'active en dev (`npm start`), seulement sur l'app
installée.

### Versions

Un seul numéro, dans `package.json` (`version`) : c'est lui qu'affichent l'installeur,
Réglages → À propos et les mises à jour automatiques. Schéma [semver](https://semver.org/lang/fr/) :

| Numéro | Étape |
|---|---|
| `0.0.x` | **bêta fermée** (actuelle) — un incrément à chaque release : `0.0.1`, `0.0.2`… |
| `0.1.0`, `0.2.0`… | bêta publique |
| `1.0.0` | première version stable |

L'auto-update ne propose **jamais une version inférieure** à celle installée : une copie
de NaX installée en `0.1.0` (ancien numéro, avant la bêta fermée) ne verra pas les `0.0.x`.
Il suffit de la réinstaller une fois depuis l'installeur de la bêta.

### Publier une nouvelle version

1. Renseigner le compte GitHub : remplacer `OWNER` dans `package.json` (voir en tête).
2. Incrémenter la version : `npm run bump` (`0.0.1` → `0.0.2`), ou `npm run bump:minor`
   (`0.0.x` → `0.1.0`). Aucun tag Git n'est créé ici : c'est la publication qui s'en charge.
   La toute première release de la bêta garde `0.0.1` (pas de bump). Ne jamais republier un
   numéro déjà publié : l'auto-update ne se déclenche que vers une version plus haute.
3. Créer un jeton GitHub (Settings → Developer settings → Personal access tokens) avec la
   portée `repo` (ou `public_repo` si le dépôt est public), puis l'exposer :

        # PowerShell
        $env:GH_TOKEN = "ghp_xxx"
        npm run publish

   electron-builder construit l'installeur et crée/complète une Release GitHub taguée
   `v<version>` avec `NaX Setup <version>.exe` et le fichier `latest.yml` que l'app lit pour
   détecter les mises à jour.
4. Les utilisateurs installés reçoivent la mise à jour automatiquement au prochain lancement.

Le tag Git de la Release doit être `v<version>` (electron-builder s'en occupe avec
`--publish always`).

## Contribuer

Projet Electron sans dépendance de build exotique. `npm install`, puis `npm start` pour
lancer en dev. Le code tient dans quatre fichiers : `main.js` (process principal),
`preload.js` (pont IPC), et `ui/` (interface). Voir les sections ci-dessus pour le détail
des fonctionnalités.

## Menus contextuels

Les menus au clic droit (onglet, appli, favori, page web) ne sont pas les menus natifs de
Windows mais des menus maison au style de NaX (police Inter, panneau arrondi translucide,
actions destructrices en rose, éléments désactivés grisés, navigation clavier). Ils sont
rendus dans une petite fenêtre overlay transparente (`ui/menu.html` + `menu-preload.js`)
placée au-dessus des vues natives, pilotée par `popupMenu(template)` dans `main.js`. Le menu
d'application (raccourcis clavier) reste natif.

## Tooltips de survol

Les infobulles natives de Windows (attribut `title`, non stylables) sont remplacées par des
tooltips maison au style de NaX. Un gestionnaire global dans l'interface intercepte le
survol, retire le `title` natif (pour éviter la double infobulle) et affiche un tooltip
personnalisé. Comme certains éléments sont au-dessus des vues web natives, le tooltip est
dessiné dans une fine fenêtre overlay transparente et click-through (`ui/tip.html` +
`tip-preload.js`), qui suit la fenêtre principale. Placement à droite pour le rail, en
dessous ailleurs, avec repli au-dessus si débordement.

## Fonctions navigateur essentielles

- **Téléchargements** : enregistrés dans le dossier Téléchargements, avec progression, et un
  panneau (bouton « Téléchargements » de la liste) pour ouvrir le fichier, le montrer dans le
  dossier, annuler ou effacer. Badge de compteur pendant les téléchargements actifs.
- **Rechercher dans la page (Ctrl+F)** : bandeau flottant en haut à droite, compteur de
  résultats, Entrée / Maj+Entrée pour naviguer, Échap pour fermer.
- **Plein écran vidéo** : les demandes de plein écran des pages (YouTube…) masquent
  l'interface et passent la fenêtre en plein écran ; Échap pour sortir.
- **Permissions** : caméra, micro, notifications, géolocalisation, MIDI, presse-papiers
  demandent une autorisation (mémorisée par site pour la session).
- **Impression (Ctrl+P)**.
- **Page d'erreur** : en cas d'échec de chargement (hors ligne, domaine invalide…), une page
  au style de NaX explique le problème avec un bouton Réessayer ; l'omnibox garde l'adresse
  visée. Même page (« Oups, la page a planté », bouton Recharger) quand le processus d'une page
  plante ou manque de mémoire, au lieu d'un onglet blanc.
- **Page figée** : si la page à l'écran ne répond plus, NaX propose d'attendre ou de l'arrêter.
- **Quitter la page ?** : une page avec des modifications non enregistrées (`beforeunload`)
  demande confirmation avant d'être quittée. Sans ce gestionnaire, Electron annulait la
  navigation sans rien dire.
- **Connexion HTTP** (Basic, NTLM, proxy) : une modale demande l'identifiant et le mot de passe
  (intranets, Jira hébergé, routeurs…). Échap ou Annuler renvoie le refus du site.
- **Adresse du lien survolé** : affichée en bas à gauche de la page, dans l'overlay des tooltips.
- **Clic droit sur une page** : corrections orthographiques (et « Ajouter au dictionnaire »),
  image (ouvrir, enregistrer sous, copier, copier l'adresse), lien (onglet privé, enregistrer
  sous), vidéo/audio (enregistrer sous), page (enregistrer sous, imprimer, code source).
- **Liens vers d'autres applis** (`mailto:`, `tel:`, Teams, Zoom, Slack…) : NaX demande avant
  d'ouvrir l'appli, avec « Toujours autoriser ce site ». Un tel lien en `target=_blank` ne laisse
  plus d'onglet vide ; tapé dans la barre d'adresse, il s'ouvre directement. Les schémas capables
  de lancer du code ou d'ouvrir des fichiers locaux (`file:`, `ms-msdt:`, `search-ms:`…) restent
  bloqués.
- **Partage d'écran** (Meet, Teams, Zoom web) : sélecteur d'écran ou de fenêtre dans l'interface,
  avec option « son de l'ordinateur » (capture loopback de Windows).
- **Sessions isolées** : onglets privés et « autre session » ont les mêmes règles que la session
  principale (autorisations, téléchargements, partage d'écran, correcteur, langues). En privé, les
  autorisations accordées sont oubliées à la fermeture.
- **Enregistrer la page (Ctrl+S)** : page complète (`.html` + dossier), un seul fichier
  (`.mhtml`) ou HTML seul (`.htm`), selon l'extension choisie.

Fichiers associés : `ui/find.html` + `find-preload.js` (recherche), `ui/error.html` (erreurs),
et la gestion des téléchargements / permissions / plein écran dans `main.js`.

### Navigateur par défaut

Réglages → Au démarrage → **Navigateur par défaut**. Windows interdit à une appli de se
déclarer elle-même navigateur par défaut : NaX s'enregistre comme navigateur (clés `HKCU`,
sans droits admin : `NaXURL` pour http/https, `NaXHTML` pour .html/.pdf/.svg…, et
`Software\Clients\StartMenuInternet\NaX`), puis ouvre sa fiche dans Paramètres Windows →
Applications par défaut, où l'utilisateur confirme. L'enregistrement est refait au lancement si
l'exécutable a changé de place. Uniquement sur l'appli installée (en dev, l'exécutable est
`electron.exe`). Les clés sont retirées à la désinstallation, mais pas lors d'une mise à jour
(`build/installer.nsh`).

Un lien ou un fichier reçu en ligne de commande (`NaX.exe <url>`) s'ouvre dans un nouvel onglet,
ou ramène à l'onglet s'il est déjà ouvert ; si NaX tourne déjà, la 2e instance lui passe le lien.

## Autocomplétion de la barre d'adresse

Suggestions classées en temps réel : onglets ouverts, favoris, historique (score de
« frécence » = fréquence + récence), suggestions de recherche Google (endpoint public, sans
clé), et détection d'URL directe. Complétion inline dans le champ (ex. « git » → « github.com »
avec la fin sélectionnée). Liste déroulante avec navigation clavier (↑ ↓, Entrée, Échap, Tab)
et souris, surlignage du terme tapé, favicons et étiquettes (Onglet, Favori). Rendue dans une
fenêtre overlay non focusable (`ui/suggest.html` + `suggest-preload.js`) pour ne pas voler le
focus du champ, au-dessus de la page. Google est interrogé en différé (~130 ms) et mis en
cache. Ranking et données côté `main.js` (`omniSuggest`, `googleSuggest`).

## Exporter une page en Markdown

Clic droit sur une page → « Exporter en Markdown ». NaX extrait le contenu lisible (article
ou contenu principal, URLs rendues absolues, nav/pubs retirées), le convertit en Markdown
(bibliothèque Turndown + plugin GFM pour les tableaux), et ouvre une modale avec deux onglets :
**Aperçu** (rendu via Marked, HTML nettoyé anti-XSS) et **Source .md** (texte brut). Boutons
**Copier** (presse-papiers) et **Télécharger** (fichier .md via une boîte d'enregistrement).
Bibliothèques dans `ui/vendor/` ; extraction et enregistrement dans `main.js`.
