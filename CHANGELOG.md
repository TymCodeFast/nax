# Changelog

Toutes les évolutions notables de NaX sont listées ici, de la plus récente à la plus ancienne.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) ; les numéros suivent [semver](https://semver.org/lang/fr/).

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
