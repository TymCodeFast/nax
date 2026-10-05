# Changelog

Toutes les évolutions notables de NaX sont listées ici, de la plus récente à la plus ancienne.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; les numéros suivent [semver](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté
- Paramètres → « Fonctionnalités bêta » : un interrupteur active ou masque toutes les fonctionnalités en bêta (désactivées par défaut).
- Le panneau IA Claude porte une marque « Bêta » et rappelle qu'il faut Claude Code installé sur la machine avec un abonnement Claude actif.
- Paramètres → Raccourcis : liste de tous les raccourcis clavier, filtrable. Le bouton « Modifier » permet de changer la touche de chaque raccourci, de le désactiver ou de le rétablir. Les infobulles et le menu du logo suivent les touches choisies.
- Menu de l'application sur le logo NaX (clic gauche, droit ou Entrée) : nouvel onglet, fenêtres, recherche, historique, téléchargements, paramètres, à propos, quitter. Les raccourcis y sont affichés.
- Plusieurs fenêtres : « Nouvelle fenêtre » (Ctrl+N) et « Nouvelle fenêtre privée » (Ctrl+Maj+N), depuis le menu du logo, le clic droit sur un lien, le clic droit sur un onglet (« Déplacer vers une nouvelle fenêtre ») et la liste de raccourcis de l'icône dans la barre des tâches Windows.
- Fenêtre privée : tous ses onglets partagent une session en mémoire, rien n'est écrit sur le disque ni dans l'historique. Teinte violette sur toute l'interface, titre suffixé « (privé) », sans rail d'applis ni panneau Claude.
- Les fenêtres normales sont restaurées au démarrage avec leur position et leur taille. Fermer une fenêtre parmi d'autres envoie ses onglets dans l'archive.
- Les demandes d'autorisation (caméra, micro, position, notifications…) proposent « Autoriser cette fois », valable jusqu'à la fermeture du navigateur, en plus de « Toujours autoriser » et « Bloquer ».

### Modifié
- « Nouvel onglet privé » passe de Ctrl+Maj+N à Ctrl+Maj+P ; Ctrl+Maj+N ouvre désormais une fenêtre privée, comme dans Chrome. Ctrl+Maj+W ferme la fenêtre.
- Seule la fenêtre principale porte le rail d'applis (session connectée), les serveurs de dev et le panneau Claude. Si elle se ferme, la plus ancienne fenêtre normale restante prend le relais.
- Les demandes d'autorisation et d'ouverture d'une autre application s'affichent dans une fenêtre de l'app au lieu d'une popup Windows. Échap ou un clic à côté refuse sans mémoriser le choix.

### Corrigé
- Google Meet (et les sites qui vérifient l'autorisation avant de la demander) ne proposait jamais d'autoriser la caméra et le micro.

## [0.1.5] - 2026-10-04

### Ajouté
- Page d'accueil avec une barre de recherche, cible du bouton Accueil et des nouveaux onglets. La recherche suit le moteur choisi.
- Mode démo (`npm run demo`) : profil séparé, onglets neutres, pour les captures et les démonstrations.
- Changelog visible dans l'app (Réglages → À propos) et dans le dépôt.

### Modifié
- En développement, le logo est rouge et une pastille DEV le signale. Masqués en démo et dans l'app installée.
- README et présentation du projet réécrits.

## [0.1.4] - 2026-10-03

### Modifié
- L'installeur s'installe en une seule étape, dans le dossier utilisateur par défaut, sans écran de choix.

## [0.1.3] - 2026-10-03

### Corrigé
- Le bouton « Redémarrer » de la mise à jour installe en silencieux : NaX se relance seul, sans l'assistant d'installation.

## [0.1.2] - 2026-10-03

### Ajouté
- Mise à jour proposée dans une bulle en bas à droite, par-dessus la page. Rien ne se télécharge sans votre accord : « Télécharger », progression, puis « Redémarrer » ou « Plus tard ».
- En cas d'échec du téléchargement, « Réessayer ».

## [0.1.1] - 2026-10-03

### Modifié
- Nouveau README. Aucun changement fonctionnel.

## [0.1.0] - 2026-10-03

Première bêta publique.

### Ajouté
- Onglets groupés automatiquement : une page ouverte depuis une autre reste avec elle. Groupes repliables et renommables.
- Veille des onglets inactifs après 2 h, et archive après 3 jours. Recherche globale avec Ctrl+K.
- Glisser-déposer des onglets et des groupes.
- Applis dans un rail, avec un widget Gmail (mails non lus et compteur).
- Favoris en arbre, téléchargements, recherche dans la page, sessions privées.
- Coffre de mots de passe chiffré par le coffre Windows, avec import depuis Chrome.
- Thème clair, sombre ou automatique, et choix du moteur de recherche.
- Mise à jour automatique depuis les releases GitHub.

## [0.0.1] - 2026-10-03

Première version de test, distribuée en bêta fermée.
