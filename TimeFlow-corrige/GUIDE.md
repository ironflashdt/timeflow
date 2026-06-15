# 🗓️ TimeFlow — Guide de démarrage

Ton clone amélioré de Reclaim.ai, **100 % local et gratuit** : ton agenda Google se connecte à l'app, une IA (Ollama, gratuite, sur ton PC) organise automatiquement tes habitudes, ton focus et tes tâches, et tu modifies tout directement dans une interface au design Apple.

Ce guide te dit **exactement** quoi faire, dans l'ordre. Compte ~15 minutes la première fois.

---

## 📦 Ce que tu vas obtenir

| Fonctionnalité Reclaim | Dans TimeFlow |
|---|---|
| Smart Scheduling | ✅ Le moteur place tes blocs automatiquement |
| Focus Time (défendu) | ✅ Blocs de travail profond chaque jour ouvré |
| Tasks (découpées avant deadline) | ✅ Tâches découpées en sessions + priorité + échéance |
| Habits (flexibles) | ✅ Habitudes qui s'adaptent aux créneaux libres |
| Priorités P1 → P4 | ✅ Sur les tâches **et** les habitudes |
| Buffer Time (pauses) | ✅ Pauses auto entre événements serrés |
| No-Meeting Days | ✅ Jours protégés |
| Calendar Sync | ✅ Google Agenda en temps réel |
| Stats / Time Tracking | ✅ Focus, réunions, habitudes, série |
| Scheduling Links (Calendly) | 🟡 Calcule tes créneaux libres (réservation publique = nécessite un hébergement, voir §9) |
| **En plus** | Assistant IA en français, Mémoire (objectifs/contraintes), heures perso ≠ heures pro, mode sombre |

---

## ✅ Prérequis (à installer une seule fois)

### Étape 1 — Node.js
1. Va sur **https://nodejs.org**
2. Télécharge la version **LTS** (le gros bouton de gauche).
3. Installe-la (Suivant → Suivant → Terminer).
4. Pour vérifier : ouvre **Invite de commandes** (tape `cmd` dans le menu Démarrer) et tape :
   ```
   node --version
   ```
   Si un numéro s'affiche (ex. `v20.x.x`), c'est bon. ✅

### Étape 2 — Ollama (l'IA gratuite)
1. Va sur **https://ollama.com/download** → télécharge la version Windows → installe.
2. Ouvre une **Invite de commandes** et télécharge le modèle (ça pèse ~4,7 Go, à faire une fois) :
   ```
   ollama pull llama3.1:8b
   ```
   > 💡 Ton RTX 3060 Ti gère `llama3.1:8b` parfaitement. Si tu veux **plus rapide** : `ollama pull llama3.2:3b` (puis mets `llama3.2:3b` dans Réglages → Modèle Ollama).

---

## 🔑 Étape 3 — Connecter Google Agenda (le point qui bloque tout le monde)

C'est l'étape la plus longue, mais tu ne la fais **qu'une fois**. Suis-la à la lettre.

### 3.1 — Créer un projet
1. Va sur **https://console.cloud.google.com**
2. En haut, clique sur le sélecteur de projet → **Nouveau projet** → nomme-le `TimeFlow` → **Créer**.
3. Sélectionne bien ce projet (en haut à gauche).

### 3.2 — Activer l'API Google Calendar
1. Menu ☰ → **API et services** → **Bibliothèque**.
2. Cherche **Google Calendar API** → clique dessus → **Activer**.

### 3.3 — Écran de consentement OAuth
1. Menu ☰ → **API et services** → **Écran de consentement OAuth**.
2. Type d'utilisateur : **Externe** → **Créer**.
3. Remplis le minimum :
   - Nom de l'application : `TimeFlow`
   - E-mail d'assistance : **ton adresse Gmail**
   - Coordonnées du développeur : **ton adresse Gmail**
   - → **Enregistrer et continuer** (laisse les écrans suivants tels quels, **Enregistrer et continuer** à chaque fois).
4. **Utilisateurs test** : clique **Add users** → ajoute **ton adresse Gmail** → **Enregistrer**.
   > ⚠️ Indispensable : sans ça, Google refusera la connexion.

### 3.4 — Créer les identifiants
1. Menu ☰ → **API et services** → **Identifiants**.
2. **Créer des identifiants** → **ID client OAuth**.
3. Type d'application : **Application Web**.
4. Nom : `TimeFlow`.
5. Dans **URI de redirection autorisés**, clique **Ajouter un URI** et colle **EXACTEMENT** ceci :
   ```
   http://localhost:3000/oauth/callback
   ```
   > 🎯 C'est LA ligne critique. Pas de `/` final, pas de `https`, pas de `www`. Si c'est différent, la connexion échouera avec une erreur `redirect_uri_mismatch`.
6. **Créer**.
7. Une fenêtre affiche ton **ID client** et ton **Code secret du client** (`client_secret`). **Garde-les ouverts** ou copie-les : tu les colleras dans l'app à l'étape 5.

---

## ▶️ Étape 4 — Lancer TimeFlow

1. Mets ces fichiers **dans le même dossier** :
   - `server.js`
   - `app.html`
   - `start.bat`
   - (et tes fichiers existants `config.json`, `habits.json`, `tasks.json`, etc. s'ils existent — sinon ils se créeront tout seuls)
2. **Double-clique sur `start.bat`.**
   (Il lance Ollama puis le serveur. Une fenêtre noire reste ouverte : c'est normal, ne la ferme pas.)

   *Alternative sans le .bat :* ouvre une Invite de commandes dans le dossier et tape `node server.js` (Ollama doit déjà tourner).
3. Tu devrais voir :
   ```
   ⚡ TimeFlow → http://localhost:3000/app
   ```
4. Ouvre ton navigateur sur **http://localhost:3000**

---

## 🔓 Étape 5 — Se connecter

**Recommandé — afficher directement « Continuer avec Google ».**
Ouvre `server.js` et colle tes identifiants (étape 3.4) dans les deux constantes près du haut du fichier :
```js
const GOOGLE_CLIENT_ID     = '....apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = 'GOCSPX-....';
```
Au lancement, la page affiche alors directement le bouton **Continuer avec Google** — plus besoin de saisir quoi que ce soit. *(Si tu utilisais déjà l'app, tu retrouves ces deux valeurs dans ton `config.json`.)*

**Sinon — saisie manuelle.** Si tu laisses les constantes vides, la page d'accueil te demande ton **ID client** et ton **Code secret** → **Connecter** (l'app les enregistre dans `config.json`, donc une seule fois).

Ensuite, dans les deux cas :
1. Clique **Continuer avec Google** et choisis ton compte.
2. Un écran **« Google n'a pas validé cette application »** apparaît → **Paramètres avancés** → **Accéder à TimeFlow (dangereux)**.
   > C'est normal : l'app est « non vérifiée » car elle tourne chez toi, pour toi. Pour autoriser d'autres personnes, ajoute-les comme **utilisateurs de test** dans l'écran de consentement OAuth (mode Test, jusqu'à 100 comptes), ou publie l'application (vérification Google requise pour le périmètre Agenda).
3. Autorise l'accès à ton agenda → tu reviens dans l'app, **connecté**, et ton **agenda est synchronisé automatiquement**.

---

## 🧭 Comment utiliser TimeFlow

- **Calendrier** : vue semaine. Clique sur un créneau vide pour créer un événement ; clique sur un événement pour le modifier ou le supprimer. Tout est synchronisé avec Google.
- **Bouton « Tout planifier »** (en haut à droite) : lance le moteur — il remplit tes 2 prochaines semaines (habitudes → focus → tâches) autour de tes réunions.
- **Priorités** : visualise tâches & habitudes rangées en colonnes P1 → P4.
- **Focus Time** : règle la durée d'un bloc de concentration ; il s'ajoute automatiquement chaque jour ouvré.
- **Habitudes** : ajoute des routines (sport, révisions…) avec jours, plage horaire et priorité. Utilise les **modèles rapides** pour aller vite.
- **Tâches** : ajoute une tâche avec durée totale, échéance et priorité ; elle est **découpée en sessions** et placée avant la deadline.
- **Pauses & marges** : insère des pauses quand deux événements sont trop collés.
- **Assistant IA** : écris en français, ex. *« bloque 2h de sport demain à 18h »*, *« ajoute une révision de maths de 3h avant vendredi »*, *« qu'est-ce que j'ai cette semaine ? »*. Il crée/modifie réellement tes événements.
- **Mémoire** : note tes objectifs, contraintes et préférences. L'IA s'en sert pour mieux planifier.
- **Réglages** : modèle Ollama, fuseau, heures de travail vs heures perso, jours sans réunion.

> Le moteur **replanifie automatiquement** : si tu ajoutes une réunion dans Google, les blocs gérés par TimeFlow se réorganisent autour (vérification toutes les minutes côté app, et toutes les 5 min côté serveur ; planning complet chaque dimanche 20h).

---

## 🔒 Étape importante — Sécurité

Tes anciens identifiants Google (le `client_secret` et le `refresh_token` présents dans tes fichiers `config.json` / `tokens.json`) ont été partagés dans notre conversation. Par précaution, **régénère-les** :

1. **Réinitialiser le secret** : Google Cloud Console → **Identifiants** → ouvre ton ID client OAuth → **Réinitialiser le code secret** (puis recolle le nouveau secret dans l'app).
2. **Révoquer l'ancien accès** : va sur **https://myaccount.google.com/permissions** → retire l'autorisation de l'ancienne app, puis reconnecte-toi proprement via TimeFlow.

C'est rapide et ça garantit que personne d'autre ne peut utiliser tes anciennes clés.

---

## 🛠️ Dépannage

| Problème | Solution |
|---|---|
| **`redirect_uri_mismatch`** | L'URI dans Google Cloud doit être **exactement** `http://localhost:3000/oauth/callback`. Re-vérifie (pas de `/` final). |
| **`accès bloqué : app non validée`** | Ajoute ton Gmail dans **Utilisateurs test** (étape 3.3.4). |
| **L'assistant IA ne répond pas** | Ollama n'est pas lancé. Ouvre un terminal et tape `ollama serve`, ou relance `start.bat`. Vérifie que le modèle dans Réglages correspond à celui téléchargé. |
| **`port 3000 déjà utilisé`** | Une ancienne instance tourne. Ferme les fenêtres noires, ou redémarre le PC, puis relance. |
| **Le calendrier semble vide / "Mode démonstration"** | Le serveur n'est pas démarré, ou tu as ouvert `app.html` en double-clic (file://). Passe **toujours par http://localhost:3000**. |
| **Page blanche** | Vérifie que `app.html` est bien dans le **même dossier** que `server.js`. |

---

## 🌐 Aller plus loin — Liens de réservation publics

En local, l'onglet **Liens de réservation** calcule et affiche tes créneaux libres. Pour qu'une **autre personne** réserve via une page web (comme Calendly/Reclaim), l'app doit être **accessible en ligne**. Deux options simples plus tard :
- héberger `server.js` sur un petit serveur (Railway, Render, un VPS…) ;
- ou utiliser un tunnel temporaire (`ngrok http 3000`) — pense alors à **ajouter l'URL HTTPS générée dans les URI de redirection** Google.

C'est une évolution « v2 » : tout le reste de l'app fonctionne dès maintenant en local.

---

Bon planning ! ⚡

---

## Nouveautés — Planner modifiable + Optimiseur type Reclaim

### Modifier le planning à la souris (synchronisé avec Google Agenda)
- **Déplacer** un bloc : cliquez-glissez n'importe quel événement (verticalement pour changer l'heure, horizontalement pour changer de jour). Aimantation toutes les 15 min.
- **Redimensionner** : attrapez la petite poignée en bas du bloc et tirez pour changer la durée.
- Chaque modification est **écrite immédiatement dans Google Agenda**.
- Un bloc déplacé manuellement est **épinglé 📌** : l'optimiseur ne le bougera plus. Pour le libérer, ouvrez-le et cliquez **Désépingler**.

### Bouton « Optimiser » (algorithme type Reclaim, sans IA)
En haut à droite du calendrier. Il réorganise automatiquement votre semaine avec un **solveur à contraintes et priorités** (pas d'IA) :
- Priorités universelles **P1 → P4** ; à priorité égale, **habitudes avant tâches**.
- Les **vrais événements** (réunions Google) et les **blocs épinglés** ne sont jamais déplacés : tout se planifie autour.
- **Tâches** : découpées en sessions (min/max), planifiées **avant l'échéance**, après la date de début, avec un **plafond par jour** pour les étaler.
- **Habitudes** : placées sur le **jour idéal** à l'**heure idéale**, X fois par semaine, dans la fenêtre horaire choisie.
- **Focus** : si vous définissez un objectif hebdomadaire dans les réglages, des blocs de concentration sont défendus sur les jours ouvrés.
- Des **marges** sont laissées entre les sessions pour éviter le dos-à-dos.

### Réglages du moteur (Réglages → Moteur de planification)
Fenêtre de planification (jours), temps max par tâche/jour, objectif Focus hebdomadaire (0 = désactivé), Focus max par jour.

---

## Nouveautés — Réglages complets (style Reclaim)

L'onglet **Réglages** affiche désormais une **grille de cartes** (comme Reclaim). Cliquez une carte pour ouvrir sa page, « ‹ Réglages » pour revenir. Tout est fonctionnel et agit réellement sur l'agenda :

- **Compte** : nom, société, poste, etc. + fuseau horaire + **début de semaine** (lundi/dimanche, qui réorganise tout le calendrier).
- **Horaires** : heures **de travail / personnelles / de réunion**, réglables **jour par jour** (case à cocher + plage). Ces plages **pilotent l'optimiseur** (les tâches/habitudes ne sont placées que dans les bonnes fenêtres, et jamais un jour décoché).
- **Calendriers** : votre **compte Google réel** (e-mail, fuseau, agendas) ; boutons Reconnecter / Déconnecter.
- **Couleurs** : une couleur par **catégorie** (Travail, Personnel, Réunion, Trajets…) appliquée aux blocs créés ; choix « blocs TimeFlow uniquement / tous ».
- **Marges** : **pauses** entre blocs, **trajets 🚗** autour des événements avec un lieu, **décompression 😌** après les réunions — réellement créés par « Appliquer maintenant ».
- **Planification** : fenêtre, **format de date**, **format d'heure (12 h / 24 h)**, début de semaine, **granularité d'aimantation**, **verrouillage auto** des blocs du jour, **emojis** devant les titres (désactivé par défaut).
- **Tâches** : valeurs **par défaut** (priorité, durée, découpage min/max, plage horaire, délai/échéance, visibilité) appliquées au formulaire de nouvelle tâche.
- **Moteur** : réglages de l'optimiseur + **jours sans réunion**.
- **Notifications** (navigateur) : **notification bureau**, **son**, **clignotement de l'onglet**, **anticipation** en minutes — fonctionnent quand l'onglet TimeFlow reste ouvert (bouton « Tester »).
- **Intelligence (IA locale)** : modèle Ollama + URL + **Tester la connexion** (liste les modèles installés).
- **Intégrations** : Google Agenda et Ollama (réels) ; les autres connecteurs sont marqués « À venir ».
- **Données** : **Exporter** (JSON : habitudes, tâches, réglages, mémoire), **Importer**, **Réinitialiser**.

> Les pages *Clockwise* et *Équipe* de Reclaim ne s'appliquent pas à une application locale mono-utilisateur : Clockwise est remplacé par **Données** (import/export), et Équipe est omis.

> Après mise à jour : remplacez `server.js` et `app.html`, relancez `start.bat`. Une fois Google connecté, testez le glisser-déposer puis le bouton **Optimiser**.

---

## Nouveautés — Planification intelligente & réorganisation automatique

Le moteur a été rapproché du fonctionnement réel de Reclaim, puis amélioré :

### 1. Réorganisation automatique (continue)
Dès que vous faites une **modification manuelle** — déplacer/redimensionner un bloc, épingler, **ajouter ou modifier une tâche ou une habitude** — TimeFlow **replanifie tout automatiquement** autour de vos contraintes (bandeau « ↻ Réorganisation… » en haut du calendrier). Plus besoin de cliquer « Optimiser » : une nouvelle tâche se case toute seule. Désactivable dans **Réglages → Planification → Réorganisation automatique**.

### 2. Ordonnancement par urgence (priorité + échéance)
Comme Reclaim, les tâches ne sont plus rangées par simple priorité : le moteur combine **priorité ET échéance**. Une tâche **P3 due demain** passe **avant** une **P2 due dans deux semaines**. Concrètement : 1) les tâches **Up Next** d'abord, 2) les tâches **à risque** (dont l'échéance approche), 3) le reste par priorité puis échéance.

### 3. Up Next ⚡
Dans le formulaire d'une tâche, cochez **« Up Next »** pour la planifier **dès que possible, avant toutes les autres tâches** (utile pour « à faire maintenant »).

### 4. Alerte de dépassement d'échéance
Si une tâche **ne tient pas** dans le temps disponible avant son échéance, un **bandeau orange** prévient (ex. « Rapport — 2h non placé avant l'échéance ») pour que vous repoussiez l'échéance, réduisiez la durée ou libériez du temps. (Vraie détection de surcharge.)

### 5. Habitudes plus fidèles
Les habitudes **se replient autour des réunions** (si le créneau idéal est pris, le moteur trouve le suivant), respectent **X fois/semaine**, le **jour & l'heure idéale**, les **dates de début/fin**, et la **défense stricte** (placées en premier). Elles ne sont posées que dans les **fenêtres horaires** définies (Réglages → Horaires, jour par jour).

### 6. Mode Focus proactif / réactif
**Réglages → Moteur → Mode Focus** : *Proactif* défend votre objectif de concentration chaque semaine ; *Réactif* (façon Reclaim) ne réserve du Focus que lorsque la semaine se remplit et que l'objectif est menacé.

> Après mise à jour : remplacez `server.js` et `app.html`, relancez `start.bat`.

---

## Nouveautés — Design, Kanban, Assistant tout-puissant & anti-chevauchement

### Refonte du design (Apple HIG)
Palette neutre, **une seule couleur d'accent** (#0071e3), ombres réduites à un filet, coins plus sobres (11–13 px), chrome moins « verre », et **micro-animations** courtes (150–250 ms) sur les vues, cartes, boutons et le glisser-déposer. Tous les emojis-icônes de l'interface (navigation, en-têtes de section, cartes, listes, modales, statuts, intégrations, page de connexion) ont été remplacés par des **icônes SVG monochromes à trait fin**, cohérentes en taille et en graisse. Les pastilles de priorité utilisent désormais des points de couleur CSS plutôt que des emojis. L'option « Emojis devant les titres » est **désactivée par défaut** : les blocs créés dans Google Agenda portent un titre propre (la détection des blocs gérés repose sur des métadonnées, plus sur les emojis).

### Onglet Priorités — Kanban
Les **Priorités** sont désormais un **tableau Kanban** à 4 colonnes (P1→P4). **Glissez-déposez** une habitude ou une tâche d'une colonne à l'autre pour changer sa priorité : c'est enregistré et le planning se **réorganise** aussitôt.

### Onglet Habitudes — au niveau de Reclaim
Le formulaire propose le choix de **plage horaire Travail / Réunions / Perso** (relié aux Horaires par jour, avec un lien « Modifier les horaires »), la **répétition** (X fois/semaine), les **jours possibles** + **jour idéal** (double-clic), l'**heure idéale**, la **durée min/max**, et des **dates de début/fin**.

### Assistant IA — contrôle total + mémoire + adaptation
L'assistant peut maintenant **tout piloter** en langage naturel et enchaîner plusieurs actions :
- **Événements** (créer/modifier/supprimer), **habitudes**, **tâches**, **priorités**, et les **réglages** (heures de travail, objectif Focus, jours sans réunion, réorganisation auto…).
- **Mémoire** de vos **objectifs**, **contraintes** et **préférences**.
- **Mode vacances** : « je suis en congés du 12 au 16 » → il enregistre l'absence, **ne planifie plus de travail** ces jours-là, **garde vos habitudes perso**, et **réorganise** le reste. (Vérifié : 0 bloc de travail sur les jours de congé.)
- Après chaque action, il **réorganise automatiquement** et signale les **tâches à risque** d'échéance.

### Règle anti-chevauchement + créneaux déduits du titre
- **Deux événements ne peuvent plus se superposer** : à la création (manuelle ou IA), un bloc en conflit est **décalé vers le prochain créneau libre**.
- L'IA **lit le titre** pour en déduire un **créneau plausible et une durée max** : « morning routine » → le **matin**, **2 h max** ; « déjeuner » → midi ; « dîner » → le soir. (Vérifié : une « morning routine » demandée à 21 h est ramenée à 5 h, 2 h max.)

> Après mise à jour : remplacez `server.js` et `app.html`, relancez `start.bat`.
