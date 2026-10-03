<p align="center">
  <img src="assets/icon.png" width="96" alt="Logo NaX">
</p>

<h1 align="center">NaX</h1>

<p align="center">
  <b>Le navigateur qui range vos onglets à votre place.</b><br>
  Open source · basé sur Chromium · Windows 10 et 11
</p>

<p align="center">
  <a href="https://github.com/TymCodeFast/nax/releases/latest"><img src="https://img.shields.io/github/v/release/TymCodeFast/nax?label=version&color=2f6fe4" alt="Dernière version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-MIT-22c55e" alt="Licence MIT"></a>
  <img src="https://img.shields.io/badge/gratuit-oui-0ea5e9" alt="Gratuit">
  <img src="https://img.shields.io/badge/open%20source-oui-7385ff" alt="Open source">
</p>

<p align="center">
  <a href="https://github.com/TymCodeFast/nax/releases/latest"><b>⬇ Télécharger NaX</b></a>
  &nbsp;·&nbsp;
  <a href="#fonctionnalités"><b>Fonctionnalités</b></a>
  &nbsp;·&nbsp;
  <a href="#installer"><b>Installer</b></a>
  &nbsp;·&nbsp;
  <a href="#pour-les-développeurs"><b>Développer</b></a>
</p>

<p align="center">
  <img src="docs/screenshots/apercu.png" alt="Aperçu de NaX : onglets groupés à gauche, favoris en bas, page web au centre" width="900">
</p>

---

## Pourquoi NaX ?

Un navigateur classique finit toujours avec quarante onglets et aucun moyen de les retrouver.
Tout le monde a promis de les ranger plus tard. NaX prend le problème dans l'autre sens :
**on organise après, ou jamais.**

NaX regroupe automatiquement ce que vous ouvrez ensemble, met en veille ce que vous ne
touchez plus, et garde tout ce qui a été ouvert à portée de recherche. Vous gardez la main,
sans effort de rangement.

---

## Fonctionnalités

### Des onglets qui s'organisent seuls

| | |
|---|---|
| **Îlots automatiques** | Une page ouverte depuis une autre reste groupée avec celle qui l'a ouverte. Le groupe se nomme tout seul, et se renomme d'un double-clic. |
| **Groupes repliables** | Un clic réduit un groupe à une barre (nom, favicons, compteur). NaX mémorise l'état. |
| **Pas de doublons** | Taper l'adresse d'une page déjà ouverte vous y ramène. Ctrl+Entrée force un nouvel onglet. |
| **Veille** | Un onglet inactif depuis 2 h s'endort, grisé, sans perdre sa place. Un clic le réveille. |
| **Archive** | Un onglet fermé, ou en veille depuis 3 jours, part dans l'archive. Rien ne se perd. |
| **Recherche partout** | Ctrl+K retrouve les onglets, la veille, l'archive et l'historique. |

### Une organisation à la souris

Glissez-déposez un onglet pour le réordonner, le grouper ou le sortir d'un groupe. Déplacez
un groupe entier par son en-tête. Le clic droit donne les mêmes actions.

### Vos applis dans le rail

- **Gmail** : widget maison avec vos mails non lus (expéditeur, objet, extrait), et un compteur sur l'icône. Un clic ouvre le mail.
- **Agenda, Drive et vos sites** : un clic les ouvre. Ajoutez n'importe quel site avec `+`.

### Favoris, mots de passe, téléchargements

- **Favoris en arbre** : dossiers, sous-dossiers, glisser-déposer. Ctrl+D pour marquer une page.
- **Coffre de mots de passe** : chiffré par le coffre Windows (DPAPI), jamais en clair sur le disque. Import depuis Chrome par CSV. Le presse-papiers est effacé après 30 secondes.
- **Téléchargements** : progression, panneau pour ouvrir ou montrer le fichier.

### Un navigateur complet

- **Page d'accueil** avec barre de recherche, sur le bouton Accueil et pour les nouveaux onglets. Elle suit votre moteur de recherche.
- **Recherche dans la page** (Ctrl+F), impression, enregistrement de page (HTML ou MHTML).
- **Partage d'écran** pour Meet, Teams ou Zoom web, avec option son de l'ordinateur.
- **Permissions par site** : caméra, micro, notifications, géolocalisation.
- **Sessions privées** : les autorisations accordées sont oubliées à la fermeture.
- **Liens vers d'autres applis** (Teams, Zoom, Slack, `mailto:`…) : NaX demande avant de les ouvrir.
- **Export en Markdown** : une page devient un texte propre, prêt à coller.
- **Recherche intelligente** dans la barre d'adresse : onglets, favoris, historique et suggestions, avec complétion.
- **Thème** clair, sombre ou automatique. Moteur de recherche au choix : Google, DuckDuckGo, Bing, Qwant, Ecosia, Brave, Startpage.
- **Navigateur par défaut** : enregistrement depuis les Réglages, puis choix dans les Paramètres Windows.

---

## Installer

1. Ouvrez la [page des Releases](https://github.com/TymCodeFast/nax/releases/latest) et téléchargez `NaX-Setup-x.y.z.exe`.
2. Lancez-le. NaX s'installe dans votre dossier utilisateur, et les raccourcis Démarrer et bureau sont créés.
3. Windows SmartScreen peut afficher un avertissement, car l'installeur n'est pas encore signé par un éditeur reconnu. Cliquez sur « Informations complémentaires », puis « Exécuter quand même ».

**Vos données** (favoris, mots de passe, réglages, onglets) vivent dans `%APPDATA%/NaX`. Elles survivent aux mises à jour, et la désinstallation ne les efface pas.

### Mises à jour automatiques

NaX vérifie au démarrage, puis toutes les 6 heures. Quand une version plus récente existe, une bulle discrète apparaît en bas à droite. Rien ne se télécharge sans votre accord : « Télécharger », puis « Redémarrer » pour installer, ou « Plus tard ».

---

## Raccourcis clavier

<details>
<summary>Voir tous les raccourcis</summary>

| Touche | Action |
|---|---|
| Ctrl+T / Ctrl+W | nouvel onglet / fermer |
| Ctrl+Shift+N | nouvel onglet privé |
| Ctrl+Shift+T | rouvrir le dernier onglet fermé |
| Ctrl+L / Alt+D / F6 | barre d'adresse |
| Ctrl+K | rechercher partout |
| Ctrl+B | replier la liste des onglets |
| Ctrl+Tab | dernier onglet utilisé |
| Ctrl+PgSuiv / Ctrl+PgPréc | onglet suivant / précédent |
| Ctrl+1 … Ctrl+8 / Ctrl+9 | n-ième onglet / dernier onglet |
| Alt+← / Alt+→ | précédent / suivant |
| Alt+Début | page d'accueil |
| Ctrl+R, F5 / Ctrl+Shift+R, Ctrl+F5 | recharger / recharger sans le cache |
| Ctrl+F | rechercher dans la page |
| Ctrl+D | ajouter ou retirer des favoris |
| Ctrl+H / Ctrl+J | historique / téléchargements |
| Ctrl+Shift+Suppr | effacer les données de navigation |
| Ctrl+S / Ctrl+P | enregistrer la page / imprimer |
| Ctrl+U | code source de la page |
| Ctrl+= / Ctrl+- / Ctrl+0 | zoom |
| F11 | plein écran |
| F12 / Ctrl+Shift+I | outils de développement (page / interface) |

</details>

---

## Feuille de route

- Suggestions personnalisées sur la page d'accueil.
- Pastilles de notification sur les applis (événement proche, etc.).
- Vue « récurrents », calculée depuis l'historique.
- Remplissage automatique des formulaires web.
- Applis en panneau latéral, en plus du plein écran.

---

## Pour les développeurs

NaX est une application Electron. Pas de chaîne de build complexe.

### Lancer en dev

Prérequis : Node.js, puis `npm install` (une fois).

    npm start

Pour une démo sans vos données (profil séparé, onglets neutres) : `npm run demo`. Le profil de démo est `%APPDATA%/NaX-demo` et ne touche jamais le profil réel.

NaX n'accepte qu'une seule instance par profil : fermez la version installée avant de lancer `npm start`, sinon le dev se fait renvoyer vers elle.

### Structure

- `main.js` : processus principal. Une fenêtre, une vue d'interface qui la couvre, et une seule vue de contenu (onglet ou appli) posée par-dessus. Modèle des onglets, groupes, applis, archive, historique et veille.
- `preload.js` : pont IPC exposé à l'interface (`window.api`). Les fenêtres overlay ont chacune leur `*-preload.js`.
- `ui/` : interface (rail, liste d'onglets, barre de navigation, palette, menus, tooltips, page d'accueil, bulle de mise à jour).
- État persisté dans `%APPDATA%/browser/state.json`.

Pour ajouter un réglage : un `.settings-navitem` dans la nav, une `.settings-pane` dans le contenu (`ui/index.html`), et le câblage dans `ui/app.js`.

### Construire l'installeur

    npm run dist

Résultat : `dist/NaX Setup x.y.z.exe` (installeur NSIS) et `dist/win-unpacked/NaX.exe`.

### Versions

Un seul numéro, dans `package.json` (`version`). Il est affiché dans l'installeur, dans Réglages → À propos, et utilisé par les mises à jour automatiques. Schéma [semver](https://semver.org/lang/fr/) :

| Numéro | Étape |
|---|---|
| `0.0.x` | bêta fermée (historique) |
| `0.1.x`, `0.2.x`… | **bêta** (actuelle) |
| `1.0.0` | première version stable |

L'auto-update ne propose jamais une version inférieure ou égale à celle installée. Ne republiez jamais un numéro déjà publié.

### Publier une version

1. Incrémenter la version : `npm run bump` (patch) ou `npm run bump:minor`. Aucun tag Git n'est créé ici.
2. Créer un jeton GitHub avec la portée `repo`, puis publier :

        # PowerShell
        $env:GH_TOKEN = "ghp_xxx"
        npm run publish

   electron-builder construit l'installeur et crée une Release GitHub taguée `v<version>`, avec `NaX-Setup-<version>.exe` et `latest.yml`, le fichier que l'app lit pour détecter les mises à jour.

### Contribuer

Les contributions sont bienvenues. Ouvrez une issue pour discuter d'une idée, puis une pull request.

---

## Licence

Distribué sous licence MIT. Voir [LICENSE](LICENSE).
