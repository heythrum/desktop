# Comptes et bibliothèque synchronisée

Thrum fonctionne localement sans Supabase. Pour retrouver la même bibliothèque sur le site et Windows, configurez un projet Supabase et connectez le même compte aux deux applications.

1. Créez un projet dans le tableau de bord Supabase. Dans **SQL Editor**, exécutez intégralement [la migration](migrations/202611050001_library_snapshots.sql). Le fichier est aussi compatible avec `supabase db push` dans un projet CLI déjà relié.
2. Dans **Authentication → Providers**, activez Email. Conservez la confirmation d’adresse activée ; configurez un service SMTP pour un usage public selon les limites du fournisseur.
3. Dans **Authentication → URL Configuration**, utilisez `https://thrum.uno` comme **Site URL** et ajoutez vos URL de déploiement autorisées. Pour le développement, ajoutez explicitement `http://127.0.0.1:5173` et `http://localhost:5173` si utilisés. Le client Windows utilise `http://127.0.0.1:43197`. La confirmation d’e-mail peut ouvrir le site dans le navigateur ; reconnectez-vous ensuite dans Windows.
4. Le projet public fourni pour Thrum est intégré dans `src/config/public.ts` et fonctionne aussi dans Windows. Il ne contient aucun identifiant administrateur. Pour le remplacer dans le Worker Cloudflare, ajoutez `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`. Ce sont l’URL de projet et la clé publique `sb_publishable_…` (ou l’ancienne clé `anon`). Le point d’entrée `/api/config` les fournit à l’application. **N’utilisez jamais une clé `service_role` ou `sb_secret_…` dans Thrum.** Les clés de service restent réservées à un serveur de confiance et ne sont pas nécessaires ici.
5. Pour un build statique ou un développement sans point d’entrée de configuration, définissez `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` dans votre configuration locale ou de build. Le Worker `rapid-dawn-3639` sert le site et `/api/config` ; Netlify reste une option alternative. Les variables `VITE_` font partie du JavaScript public ; elles ne doivent contenir que la clé publique. Redémarrez le serveur ou reconstruisez après modification.

La priorité de configuration est : variables publiques `VITE_SUPABASE_*` du build, puis projet public explicite de `src/config/public.ts`, puis point d’entrée `/api/config` si aucune des deux premières sources n’est disponible. Le repli de la version Windows utilise `https://thrum.uno/api/config` ; ce domaine doit être déployé pour cette dernière voie. Intégrer une adresse et une clé publique ne crée pas la table : la migration SQL doit être exécutée dans le projet.

## Données et conflits

La table `library_snapshots` contient un document JSON par utilisateur : titres, playlists, favoris, file d’attente, historique et réglages du lecteur. Les clés YouTube, les sessions d’autres services et les fichiers de paroles LRC séparés ne font pas partie de ce document.

Les politiques RLS limitent les lectures et écritures à `auth.uid() = user_id`. Une personne anonyme n’accède à aucune bibliothèque. Le RPC `save_library_snapshot` déduit lui-même l’utilisateur de la session et compare la révision attendue ; il refuse d’écraser une modification faite depuis un autre appareil. Le client doit alors recharger la version en ligne ou proposer une résolution explicite. La première sauvegarde ne peut pas remplacer un compte existant.

La limite est de 5 Mo, 5 000 titres et 200 playlists par bibliothèque. Le service transporte les métadonnées et les références YouTube ; il n’héberge pas les fichiers musicaux. Les vidéos restent lues par YouTube.

## Validation avant ouverture publique

Exécutez la migration dans votre projet, puis vérifiez avec deux comptes différents qu’aucun ne peut lire la ligne de l’autre. Testez une création de compte et sa confirmation, une sauvegarde, une reconnexion depuis un autre appareil et un conflit entre deux appareils. Les tests du dépôt vérifient les contrats client avec des réponses simulées et exécutent la migration dans un moteur PostgreSQL PGlite pour contrôler les politiques RLS, les limites et les conflits de révision. Ils ne prouvent pas qu’une migration a été appliquée dans le projet distant ni que son authentification est configurée.
