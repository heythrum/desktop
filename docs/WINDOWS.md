La version 1.0.2 ajoute la recherche de versions alternatives lors des erreurs YouTube 100/101/150 et un filtre familial facultatif (désactivé par défaut). Un morceau explicite n’est pas nécessairement bloqué ; une restriction d’intégration, d’âge ou de région reste décidée par YouTube. Aucune configuration ne garantit tous les titres. Le choix d’une version alternative demande une clé de recherche disponible et reste explicite pour éviter de lancer une mauvaise version.

# Télécharger et configurer Thrum

Téléchargement public : https://github.com/heythrum/desktop/releases/latest

Dans Assets, choisissez `Thrum-1.0.3-x64-setup.exe` pour installer, ou `Thrum-1.0.3-portable.exe` pour lancer sans installation. Les fichiers sont publiés quand le workflow du tag a terminé avec succès. Une page Releases vide indique que la compilation est encore en cours ou a échoué ; consultez Actions.

Au premier lancement Windows, **Configurer Thrum** permet de saisir, tester et enregistrer votre clé YouTube personnelle. Ce panneau reste accessible depuis la barre latérale. Il contient aussi les liens pour installer GitHub Desktop, ouvrir le dépôt, modifier la configuration publique et gérer Cloudflare.

La clé personnelle ne modifie pas GitHub ni le serveur. Pour la recherche de tout le site, utilisez le secret `YOUTUBE_API_KEY` du Worker Cloudflare. GitHub Desktop gère votre connexion GitHub : clonez le dépôt, modifiez les fichiers puis faites Commit et Push. Une nouvelle version Windows se publie via un tag `v...` ; le site se reconstruit si Workers Builds est connecté.

---

# Tester Thrum sur Windows

La version Windows utilise le même lecteur et les mêmes comptes Supabase que le site dans une application Electron. Elle nécessite Internet pour lire YouTube. Elle ne télécharge pas de morceaux et ne contourne pas les restrictions de YouTube.

## Option A : récupérer l’installeur depuis GitHub

Une fois le code publié dans `heythrum/desktop` :

1. Ouvrez l’onglet **Actions** du dépôt GitHub.
2. Ouvrez le workflow **Validate and build Windows** et lancez-le manuellement s’il n’a pas déjà été exécuté sur votre branche.
3. Attendez la réussite des vérifications et de la construction.
4. Dans les artefacts de cette exécution, téléchargez **Thrum-Windows**.
5. Décompressez l’archive et ouvrez le fichier `.exe`.

Un artefact Actions n’est pas une publication GitHub Releases. Il peut expirer selon les réglages du dépôt, et une exécution échouée ne fournit pas nécessairement d’installeur. Cette méthode ne nécessite pas de compilateur sur votre PC.

## Option B : lancer le projet avec Git

Installez **Git pour Windows** et **Node.js 22.12 ou ultérieur**, puis ouvrez PowerShell :

```powershell
git clone https://github.com/heythrum/desktop.git
cd desktop
npm ci
npm run desktop:dev
```

Ces commandes supposent que les nouveaux fichiers du projet ont été publiés sur GitHub. Le premier téléchargement de dépendances peut prendre quelques minutes. Arrêter la commande avec `Ctrl+C` ferme la session de développement ; aucune installation système de Thrum n’est effectuée dans ce mode.

Pour récupérer plus tard des modifications publiées, depuis le même dossier, et après avoir sauvegardé vos éventuelles modifications locales :

```powershell
git pull --ff-only
npm ci
npm run desktop:dev
```

## Construire son propre .exe

Depuis le dossier du projet sur Windows :

```powershell
npm run check
npm run desktop:win
```

La commande compile l’interface puis prépare un installeur NSIS Windows x64 et une version portable dans **`release/`**. Le fichier `Thrum-<version>-x64-setup.exe` installe Thrum ; `Thrum-<version>-portable.exe` permet un essai sans installation. Fermez l’application avant de reconstruire ou de remplacer ses fichiers.

La construction Windows du workflow GitHub utilise un système Windows. Elle sert aussi de solution si vous développez sur Linux ou macOS ; la disponibilité d’une compilation croisée dépend des outils natifs et ne remplace pas un test sur Windows.

### Signature Windows

Le projet ne contient aucun certificat de signature. Un installeur construit ainsi peut déclencher un avertissement SmartScreen « éditeur inconnu ». Pour vos essais, vérifiez qu’il provient bien de votre dépôt et de votre propre construction avant de l’ouvrir. Une diffusion publique avec un éditeur identifié demande une procédure de signature et un certificat distincts ; ceux-ci ne sont pas fournis avec le code.

## Première utilisation

1. Lancez Thrum. Ouvrez **Mon compte** pour vous connecter avec le même compte que sur le site et choisissez explicitement la bibliothèque à conserver. Cette étape demande la migration Supabase configurée par l’administrateur.
2. Testez un morceau proposé ou ajoutez une URL YouTube.
3. Dans l’onglet Paroles, importez un fichier `.lrc` pour le morceau sélectionné si vous en possédez un. Les phrases suivent les repères du fichier ; cliquez sur une ligne pour déplacer la lecture et ajustez le décalage si nécessaire.
4. La recherche peut utiliser l’API du site hébergé lorsque sa clé serveur est configurée. Une clé **YouTube Data API v3** personnelle peut aussi être renseignée dans les paramètres. Le [guide d’hébergement](DEPLOYMENT.md#2-activer-la-recherche-youtube) explique les restrictions ; une clé personnelle limitée au domaine du site ne convient pas à l’origine locale de Windows.
5. Créez vos favoris et playlists, puis exportez régulièrement votre bibliothèque.

La clé personnelle est conservée localement ; ce n’est pas un coffre-fort chiffré. Ne partagez pas le profil de l’application avec cette clé. Les sauvegardes de bibliothèque ne contiennent pas la clé API ni les fichiers LRC. Conservez ces fichiers séparément : ils sont enregistrés localement pour chaque morceau.

L’application Windows utilise `http://127.0.0.1:43197/` pour garder sa bibliothèque sur une origine stable. Une clé personnelle peut être restreinte au référent `http://127.0.0.1:43197/*` ; pour le développement, ajoutez séparément `http://127.0.0.1:5173/*` si nécessaire.

## Limitations utiles à connaître

- Le compte reste facultatif. Avec le même compte Supabase et la synchronisation activée, les modifications locales sont sauvegardées en ligne. Les changements d’un autre appareil sont vérifiés toutes les 30 secondes et au retour dans la fenêtre, puis chargés si aucune modification locale n’est en attente ; un conflit demande votre choix. Les clés YouTube et les fichiers LRC restent locaux.
- Le lecteur officiel YouTube doit rester visible. Les publicités et restrictions de YouTube continuent de s’appliquer.
- Un premier clic de l’utilisateur peut être requis pour lancer la lecture.
- L’application doit pouvoir joindre les services YouTube/Google ; un pare-feu ou une politique réseau peut bloquer ces accès.
- Le contenu compilé est servi par un serveur HTTP local, accessible uniquement depuis le PC. Cela ne publie pas votre application sur Internet et ne nécessite pas d’ouvrir un port sur votre routeur.

## Mises à jour du site et de Windows

Les pushes sur `heythrum/desktop` mettent à jour le site lorsque **Workers Builds** est lié à ce dépôt et à `main`. Les créations de playlists dans Windows mettent à jour les données du compte via Supabase ; elles ne déploient pas de code sur Cloudflare.

Le projet ne contient pas de mise à jour automatique silencieuse du programme Windows. Après un changement du code, récupérez un nouvel artefact **Thrum-Windows** ou reconstruisez depuis Git. Les paramètres publics Supabase intégrés permettent de retrouver le même projet ; une clé administrateur n’a jamais sa place dans le `.exe`.
