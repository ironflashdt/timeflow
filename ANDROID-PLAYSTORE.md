# TimeFlow sur Android (Play Store) — guide pas à pas

L'app mobile = la même interface web TimeFlow, **hébergée en ligne**, installée en PWA puis empaquetée en **app Play Store (TWA)**.
Les données PC ↔ téléphone sont **synchronisées via Supabase** (déjà en place).

> ⚠️ Sécurité : héberger l'app la rend accessible publiquement. Avant un usage réel, on ajoutera une **protection par mot de passe** (étape 6). Tant que ce n'est pas fait, ne partage pas l'URL.

## Étape 1 — Mettre le code sur GitHub
1. Crée un dépôt GitHub privé.
2. Pousse le contenu de ce dossier (`server.js`, `app.html`, `vendor/`, `models/`, `package.json`, `Dockerfile`, `render.yaml`).

## Étape 2 — Héberger gratuitement (Render)
1. Va sur **render.com** → inscris-toi (gratuit).
2. **New ▸ Blueprint** → choisis ton dépôt → Render lit `render.yaml`.
3. Laisse-le déployer (~3 min). Tu obtiens une URL, ex. `https://timeflow-xxxx.onrender.com`.
4. Onglet **Environment** → ajoute `TF_PUBLIC_URL = https://timeflow-xxxx.onrender.com` → **Save** → redéploie.

## Étape 3 — Reconnecter Google + Supabase à cette URL
1. **Google Cloud Console** ▸ Credentials ▸ ton client OAuth :
   - Authorized redirect URIs → ajoute `https://timeflow-xxxx.onrender.com/oauth/callback`.
2. Ouvre l'URL dans un navigateur → connecte Google → vérifie que le calendrier s'affiche.

## Étape 4 — Vérifier la PWA
Sur Chrome Android, ouvre l'URL → menu ⋮ → **Ajouter à l'écran d'accueil**. L'app s'installe déjà (utilisable tout de suite, sans le Store).

## Étape 5 — Empaqueter pour le Play Store (TWA via Bubblewrap)
Sur ton PC (Node installé) :
```
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://timeflow-xxxx.onrender.com/manifest.webmanifest
bubblewrap build
```
- Bubblewrap génère un **`.aab`** (à téléverser) + une **clé de signature** (garde-la précieusement).
- Il faut le fichier **`/.well-known/assetlinks.json`** servi par l'app (je peux l'ajouter au serveur une fois ton empreinte de clé connue).

## Étape 6 — (important) Protéger l'accès
Avant de publier : je t'ajoute une **page mot de passe** côté serveur (sinon n'importe qui avec l'URL accède à ton agenda). Dis-le-moi quand tu en es là.

## Étape 7 — Publier sur le Play Store
1. **Google Play Console** → crée un compte développeur (**25 $**, une fois).
2. Crée une app → téléverse le `.aab` → remplis la fiche (titre, descriptions, captures, politique de confidentialité).
3. Soumets en test interne d'abord (validation ~quelques heures à 2 jours).

---
### Ce que je peux faire pour toi (dis-moi quand tu y es)
- Ajouter la **route `/.well-known/assetlinks.json`** (étape 5) avec ton empreinte SHA-256.
- Ajouter la **protection par mot de passe** (étape 6).
- Ajuster la mise en page mobile selon tes retours.
### Ce qui ne peut se faire que de ton côté
- Créer les comptes Render et Google Play Developer, pousser sur GitHub, téléverser le `.aab`, signer l'app.
