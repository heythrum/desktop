# Déployer Thrum sur Cloudflare Workers

La cible du projet est le Worker existant **`rapid-dawn-3639`**, déjà accessible via une adresse `workers.dev`, avec le domaine **thrum.uno**. Ne créez pas un second site Pages pour remplacer cette configuration par erreur. `wrangler.toml` sert `dist/` via la liaison `ASSETS` et envoie `/api/*` au Worker.

## 1. Relier le dépôt aux mises à jour automatiques

Dans le tableau de bord Cloudflare, ouvrez **Workers & Pages → rapid-dawn-3639 → Settings → Builds** et reliez le dépôt GitHub **`heythrum/desktop`**. Les intitulés peuvent évoluer ; choisissez bien la liaison Git du Worker existant.

| Réglage | Valeur |
| --- | --- |
| Branche de production | `main` |
| Racine du projet | Racine du dépôt |
| Commande de build | `npm run build` |
| Commande de déploiement | `npx wrangler deploy` |
| Node.js | 22.12 ou ultérieur compatible, `NODE_VERSION=22` |
| Variable de build | `ELECTRON_SKIP_BINARY_DOWNLOAD=1` |

La dépendance Wrangler est verrouillée dans le projet. Cloudflare fournit l’authentification de son propre processus de build : aucun jeton n’a besoin d’être placé dans Git. Lancez un premier build après la liaison, puis consultez son journal et la version déployée. Les pushes suivants sur `main` déclenchent les mises à jour du site.

Le domaine `thrum.uno` doit rester attaché au même Worker dans **Settings → Domains & Routes**. Le projet ne modifie pas automatiquement vos DNS. Si une modification est nécessaire, appliquez uniquement les cibles données par Cloudflare et préservez les enregistrements utiles aux autres services et aux e-mails.

## 2. Activer la recherche YouTube

Dans Google Cloud Console, activez **YouTube Data API v3**, créez une clé dédiée et restreignez-la à cette API. Dans les variables et secrets **du Worker en production**, ajoutez **`YOUTUBE_API_KEY` comme secret**. La clé est utilisée côté serveur et n’est jamais retournée au navigateur.

Redéployez/rechargez la version après modification selon les indications Cloudflare. Une variable de build seule ne remplace pas une liaison d’environnement disponible au Worker pendant les requêtes. Ne créez pas de variable `VITE_YOUTUBE_API_KEY` : les variables `VITE_*` sont publiques.

Une clé serveur ne doit pas être restreinte comme une clé navigateur par référent HTTP. Une restriction IP exige une sortie stable effectivement fournie par l’hébergeur ; ne devinez pas d’adresse. Surveillez les quotas et alertes dans Google Cloud. Une recherche coûte habituellement 100 unités ; vérifiez les coûts et plafonds réels du projet. Le cache ne garantit pas un trafic ou une utilisation gratuite illimités.

Sans clé, `/api/search` retourne une erreur de configuration explicite ; la bibliothèque, les liens YouTube et la lecture restent disponibles. La version Windows peut utiliser l’API hébergée ou une clé personnelle adaptée à son origine locale. Voir [Windows](WINDOWS.md).

## 3. Activer Supabase

Le projet public fourni est défini dans `src/config/public.ts`. Ce fichier contient seulement l’URL de projet et la clé **publishable**, qui sont prévues pour un client public. La sécurité des bibliothèques repose sur les sessions d’utilisateur et les politiques RLS, pas sur le masquage de cette clé.

1. Dans le projet Supabase correspondant, exécutez entièrement [la migration SQL](../supabase/migrations/202611050001_library_snapshots.sql) via SQL Editor.
2. Activez l’authentification Email et la confirmation d’adresse. Configurez votre SMTP pour un usage public en respectant les limites Supabase.
3. Définissez `https://thrum.uno` comme **Site URL** et autorisez précisément les URL de confirmation et récupération utilisées par votre site. Les liens de récupération sont ouverts sur le site ; reconnectez-vous ensuite dans Windows. Ajoutez séparément les origines de développement si nécessaires.
4. Testez deux comptes distincts, une sauvegarde, un chargement sur un autre appareil et un conflit de révisions. Le [guide Supabase](../supabase/README.md) explique les garanties et limites.

Pour remplacer le projet sans modifier le code, le Worker accepte une paire complète **`SUPABASE_URL`** et **`SUPABASE_PUBLISHABLE_KEY`** (ou l’ancienne clé `SUPABASE_ANON_KEY`). `GET /api/config` n’expose que ces données publiques. Les clients compilés peuvent aussi être configurés avec `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` ; ces valeurs sont intégrées au JavaScript public.

**Ne placez jamais `service_role`, `sb_secret_…` ou un mot de passe de base de données dans une clé de client public.** Ils ne sont pas nécessaires au fonctionnement de Thrum. Un remplacement de projet doit aussi mettre à jour les paramètres publics de build ou `src/config/public.ts` utilisés par les clients déjà compilés.

## 4. Déploiement facultatif depuis GitHub Actions

Le workflow **Validate and build Windows** exécute les tests, compile le site, produit l’artefact **Thrum-Web** puis construit **Thrum-Windows** sur Windows. Son job `deploy` est facultatif.

Pour déployer par ce job, ajoutez dans les secrets du dépôt GitHub :

- **`CLOUDFLARE_API_TOKEN`** : jeton limité au compte et aux permissions Workers nécessaires au déploiement.
- **`CLOUDFLARE_ACCOUNT_ID`** : identifiant du compte qui possède le Worker.

Ne partagez pas ces valeurs dans une conversation ou dans le dépôt. Sans ces secrets, le job affiche les étapes à configurer et ne prétend pas avoir déployé. Préférez une seule voie principale de déploiement (Workers Builds ou Actions) pour éviter les publications concurrentes.

Le workflow n’exécute pas les déploiements de production sur les pull requests. Les artefacts ont une durée de conservation limitée et ne sont pas des publications GitHub Releases.

## 5. Test local du Worker

```sh
npm ci
npm run build
npm run cloudflare:dev
```

Suivez l’adresse locale indiquée par Wrangler. Pour une clé de recherche locale, créez `.dev.vars` ignoré par Git et utilisez les mécanismes de secrets locaux de Wrangler. Une installation locale n’applique aucune migration distante et ne publie pas le site.

`npm run dev` démarre Vite pour travailler sur l’interface. Ce serveur seul n’exécute pas le Worker. `npm run deploy:cloudflare` est destiné à un environnement déjà authentifié auprès du bon compte Cloudflare ; ne l’exécutez pas pour simplement tester l’interface.

## 6. Contrôles après déploiement

- Vérifiez le domaine HTTPS et la version du build dans Cloudflare.
- `GET /api/config` doit retourner uniquement une URL Supabase et une clé publique ; aucune clé YouTube ou administrateur.
- Recherchez un titre, écoutez une vidéo autorisée à l’intégration, ajoutez un favori et une playlist.
- Créez un compte, confirmez votre e-mail puis activez explicitement la sauvegarde locale vers le compte.
- Connectez le même compte sur un autre navigateur ou Windows et chargez sa bibliothèque en ligne.
- Avec deux comptes différents, vérifiez que chacun ne voit que sa propre bibliothèque.
- Testez une modification concurrente : l’application doit demander une résolution plutôt qu’écraser une version à l’insu de l’utilisateur.

Ces contrôles doivent être faits sur les services réels. Les tests locaux avec réponses simulées ou une base de test ne prouvent pas que la migration distante ou l’authentification ont été appliquées.

## Autres hébergements

**Cloudflare Pages** : `functions/api/` fournit les adaptateurs `/api/config` et `/api/search`. Configurez build `npm run build`, publication `dist`, Node22 et les variables de fonctions. Le fichier `public/_routes.json` limite les fonctions à `/api/*` ; sans page404 personnalisée, le repli SPA est fourni par Pages. Cette voie est facultative et distincte du Worker actuel.

**Netlify** : `netlify.toml` conserve les mêmes routes via `netlify/functions/`. Ajoutez les variables `YOUTUBE_API_KEY`, `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` à cet hébergement si vous choisissez cette voie. Elle n’est pas utilisée pour mettre à jour votre Worker Cloudflare.

| Problème | Vérification |
| --- | --- |
| Le site n’a pas changé après un push | Dépôt/branche liés au Worker, journal Workers Builds, commande de déploiement et version active |
| `/api/*` renvoie du HTML | Worker correctement déployé, routes `run_worker_first` et liaison `ASSETS` |
| Recherche non configurée | Secret `YOUTUBE_API_KEY` disponible au Worker en production |
| Clé YouTube refusée | API activée, clé valide, restrictions adaptées et quota |
| Compte connecté mais sauvegarde impossible | Migration SQL appliquée, RPC présent, RLS et session d’utilisateur |
| Conflit de bibliothèque | Vérifier la version en ligne et choisir explicitement celle à conserver |
| Domaine inaccessible | Domaine toujours attaché au Worker, DNS et certificat HTTPS |
