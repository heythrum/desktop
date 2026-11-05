# Thrum

Votre espace musical pour **[thrum.uno](https://thrum.uno)**, sur le web et dans une application Windows. Le projet réunit lecture YouTube officielle, recherche, favoris, playlists et bibliothèque synchronisée avec un compte Supabase. L’interface est en français et s’adapte au téléphone.

Thrum est une application originale : elle ne reprend ni le code ni le serveur de Liner.

## Fonctions

- Sélection musicale, import de liens YouTube, lecteur vidéo visible, volume, navigation, répétition et lecture aléatoire.
- Bibliothèque, favoris, file d’attente et historique enregistrés localement.
- Comptes par e-mail, réinitialisation de mot de passe et sauvegarde privée Supabase : même compte sur le site et Windows, choix explicite de la version à conserver, protection contre les écrasements concurrents.
- Import CSV Spotify au format Exportify, recherche des correspondances sur YouTube et validation des suggestions avant création de playlist. Un lien Spotify peut aussi être ouvert dans son lecteur officiel. Il ne s’agit pas d’une synchronisation permanente avec Spotify.
- Liens de partage autonomes de playlists, jusqu’à 50 titres, sans serveur de partage.
- Import de paroles `.lrc`, synchronisation par ligne, clic pour déplacer la lecture et décalage de −30 à +30 secondes.
- Sauvegarde et restauration JSON de la bibliothèque, hors clés personnelles et fichiers LRC.

La recherche par titre ou artiste utilise **YouTube Data API v3**. Elle demande une clé serveur `YOUTUBE_API_KEY` sur l’hébergement ou une clé personnelle dans les paramètres. Sans clé, les liens et le lecteur restent utilisables. La disponibilité des vidéos, les publicités et les restrictions mobiles/géographiques dépendent de YouTube ; Thrum ne télécharge pas la musique et ne promet pas de lecture hors connexion.

## Installer et tester

Prérequis : **Node.js 22.12 ou ultérieur**, npm et Git.

```sh
git clone https://github.com/heythrum/desktop.git
cd desktop
npm ci
npm run dev
```

Ouvrez l’adresse affichée par Vite. Pour tester les API du site avec le Worker local :

```sh
npm run build
npm run cloudflare:dev
```

Vite seul ne sert pas les API `/api/*`. Avec le Worker local, ajoutez les secrets de développement dans un fichier `.dev.vars` ignoré par Git, ou utilisez les mécanismes locaux sécurisés de Wrangler. Ne versionnez jamais de clé YouTube ni de jeton administrateur.

```sh
npm run check
npm run test:e2e
```

Les tests de navigateur demandent Chromium : `npx playwright install chromium` sur une installation standard. Dans un environnement ayant déjà Chromium, utilisez `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` avec son chemin. `npm run check` vérifie TypeScript, le build et les tests unitaires/fonctionnels. Les tests simulant les services externes ne prouvent pas que vos services distants sont configurés.

## Windows

```powershell
npm run desktop:dev
# Pour produire un installeur et une version portable :
npm run desktop:win
```

Les `.exe` sont générés dans `release/`. Le workflow GitHub **Validate and build Windows** construit aussi les artefacts **Thrum-Windows** après les vérifications. [Guide Windows](docs/WINDOWS.md).

## Supabase : activer les comptes

Les identifiants **publics** du projet Supabase fourni sont intégrés dans `src/config/public.ts` ; ils ne donnent aucun droit administrateur. Il reste à appliquer [la migration SQL](supabase/migrations/202611050001_library_snapshots.sql) dans ce projet et à configurer l’authentification et les URL autorisées. [Guide Supabase](supabase/README.md).

Chaque bibliothèque est protégée par les politiques RLS et rattachée à l’utilisateur connecté. La synchronisation ne démarre pas en écrasant automatiquement une bibliothèque existante : l’interface demande de choisir la version à conserver. Les modifications locales sont ensuite sauvegardées automatiquement ; les changements en ligne sont vérifiés périodiquement et au retour dans l’application. Une version distante est chargée automatiquement si cet appareil n’a aucune modification en attente. Vous pouvez aussi charger la version en ligne manuellement. Les conflits suspendent les écritures jusqu’à votre choix.

## Mettre à jour le site automatiquement

La cible principale est le **Cloudflare Worker existant `rapid-dawn-3639`**, qui sert le site et les API. Le domaine `thrum.uno` peut rester attaché à ce Worker. Le fichier `wrangler.toml` décrit le Worker et les assets `dist`.

Connectez `heythrum/desktop`, branche `main`, aux **Workers Builds** dans Cloudflare : commande de build `npm run build`, commande de déploiement `npx wrangler deploy`. Après cette liaison, chaque push sur `main` déclenche la mise à jour du site. Une autre voie facultative est le job GitHub Actions `deploy`, activé en renseignant les secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.

Ajouter des titres dans l’application synchronise vos **données** via Supabase ; modifier le code dans Git et le pousser met à jour le **site** via l’hébergeur. Les exécutables déjà installés ne se remplacent pas automatiquement : téléchargez un nouveau build Windows.

Le dépôt conserve aussi les adaptateurs Cloudflare Pages et Netlify pour d’autres déploiements. [Guide complet d’hébergement](docs/DEPLOYMENT.md).

## Données et confidentialité

Sans connexion, la bibliothèque reste dans ce navigateur ou cette installation. Avec un compte, elle peut être envoyée au projet Supabase, avec vos références de titres, playlists, favoris, historique et réglages de lecteur. Aucun fichier musical n’y est envoyé. Les sessions de connexion sont conservées localement par le client Supabase ; déconnectez-vous sur un ordinateur partagé.

La clé YouTube personnelle et les fichiers de paroles restent locaux, en dehors de la synchronisation et de la sauvegarde JSON de bibliothèque. Conservez vos fichiers LRC originaux et une sauvegarde de vos playlists. Une clé personnelle n’est pas un secret chiffré : utilisez une clé dédiée et restreinte.

La lecture et les images contactent YouTube/Google ; la recherche passe par Google directement ou par l’API du site. L’aperçu Spotify charge son lecteur officiel. Les fournisseurs appliquent leurs propres conditions. Aucune parole n’est inventée ou récupérée automatiquement.

## Structure

| Dossier | Usage |
| --- | --- |
| `src/` | Interface React, lecteur, comptes et bibliothèque |
| `server/` | Logique partagée des API publiques |
| `worker/` | Point d’entrée Cloudflare Workers et tests |
| `functions/api/` | Adaptateurs facultatifs Cloudflare Pages |
| `netlify/functions/` | Adaptateurs facultatifs Netlify |
| `supabase/` | Migration SQL, RLS et guide |
| `electron/` | Application Windows et serveur HTTP local isolé |
| `.github/workflows/` | Vérifications, artefacts web/Windows et déploiement facultatif |

Les offres gratuites des fournisseurs ont des quotas et peuvent évoluer. L’ajout d’un fichier de configuration ne crée pas les ressources distantes, n’applique pas la migration SQL et ne prouve pas qu’un déploiement a réussi.
