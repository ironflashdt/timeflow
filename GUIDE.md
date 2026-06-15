# 🗓️ TimeFlow — Guide de démarrage

Ton clone amélioré de Reclaim.ai, **100 % local et gratuit** : ton agenda Google se connecte à l'app, une IA (Ollama, gratuite, sur ton PC) organise automatiquement tes habitudes, ton focus et tes tâches, et tu modifies tout directement dans une interface au design Apple.

Ce guide te dit **exactement** quoi faire, dans l'ordre. Compte \~15 minutes la première fois.

\---

## 📦 Ce que tu vas obtenir

|Fonctionnalité Reclaim|Dans TimeFlow|
|-|-|
|Smart Scheduling|✅ Le moteur place tes blocs automatiquement|
|Focus Time (défendu)|✅ Blocs de travail profond chaque jour ouvré|
|Tasks (découpées avant deadline)|✅ Tâches découpées en sessions + priorité + échéance|
|Habits (flexibles)|✅ Habitudes qui s'adaptent aux créneaux libres|
|Priorités P1 → P4|✅ Sur les tâches **et** les habitudes|
|Buffer Time (pauses)|✅ Pauses auto entre événements serrés|
|No-Meeting Days|✅ Jours protégés|
|Calendar Sync|✅ Google Agenda en temps réel|
|Stats / Time Tracking|✅ Focus, réunions, habitudes, série|
|Scheduling Links (Calendly)|🟡 Calcule tes créneaux libres (réservation publique = nécessite un hébergement, voir §9)|
|**En plus**|Assistant IA en français, Mémoire (objectifs/contraintes), heures perso ≠ heures pro, mode sombre|

\---

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
2. Ouvre une **Invite de commandes** et télécharge le modèle (ça pèse \~4,7 Go, à faire une fois) :

```
   ollama pull llama3.1:8b
   ```

> 💡 Ton RTX 3060 Ti gère `llama3.1:8b` parfaitement. Si tu veux \\\\\\\\\\\\\\\*\\\\\\\\\\\\\\\*plus rapide\\\\\\\\\\\\\\\*\\\\\\\\\\\\\\\* : `ollama pull llama3.2:3b` (puis mets `llama3.2:3b` dans Réglages → Modèle Ollama).

\---

## 🔑 Étape 3 — Connecter Google Agenda (le point qui bloque tout le monde)

C'est l'étape la plus longue, mais tu ne la fais **qu'une fois**. Suis-la à la lettre.

### 3.1 — Créer un projet

3. Va sur **https://console.cloud.google.com**
4. En haut, clique sur le sélecteur de projet → **Nouveau projet** → nomme-le `TimeFlow` → **Créer**.
5. Sélectionne bien ce projet (en haut à gauche).

   ### 3.2 — Activer l'API Google Calendar

6. Menu ☰ → **API et services** → **Bibliothèque**.
7. Cherche **Google Calendar API** → clique dessus → **Activer**.

   ### 3.3 — Écran de consentement OAuth

8. Menu ☰ → **API et services** → **Écran de consentement OAuth**.
9. Type d'utilisateur : **Externe** → **Créer**.
10. Remplis le minimum :

    * Nom de l'application : `TimeFlow`
    * E-mail d'assistance : **ton adresse Gmail**
    * Coordonnées du développeur : **ton adresse Gmail**
    * → **Enregistrer et continuer** (laisse les écrans suivants tels quels, **Enregistrer et continuer** à chaque fois).
11. **Utilisateurs test** : clique **Add users** → ajoute **ton adresse Gmail** → **Enregistrer**.

    > ⚠️ Indispensable : sans ça, Google refusera la connexion.

    ### 3.4 — Créer les identifiants

12. Menu ☰ → **API et services** → **Identifiants**.
13. **Créer des identifiants** → **ID client OAuth**.
14. Type d'application : **Application Web**.
15. Nom : `TimeFlow`.
16. Dans **URI de redirection autorisés**, clique **Ajouter un URI** et colle **EXACTEMENT** ceci :

    &#x20;   ```
http://localhost:3000/oauth/callback

    http://localhost:3000/oauth/callback

    &#x20;   ```

    > 🎯 C'est LA ligne critique. Pas de `/` final, pas de `https`, pas de `www`. Si c'est différent, la connexion échouera avec une erreur `redirect\\\\\\\\\\\\\\\_uri\\\\\\\\\\\\\\\_mismatch`.

17. \\\*\\\*Créer\\\*\\\*.

17. \*\*Créer\*\*.
18. Une fenêtre affiche ton \*\*ID client\*\* et ton \*\*Code secret du client\*\* (`client\\\\\\\\\\\\\\\_secret`). \*\*Garde-les ouverts\*\* ou copie-les : tu les colleras dans l'app à l'étape 5.

    \\---

    ## ▶️ Étape 4 — Lancer TimeFlow

19. Mets ces fichiers \*\*dans le même dossier\*\* :

    \* `server.js`
\* `app.html`
\* `start.bat`
\* (et tes fichiers existants `config.json`, `habits.json`, `tasks.json`, etc. s'ils existent — sinon ils se créeront tout seuls)

20. \*\*Double-clique sur `start.bat`.\*\*
(Il lance Ollama puis le serveur. Une fenêtre noire reste ouverte : c'est normal, ne la ferme pas.)

    \*Alternative sans le .bat :\* ouvre une Invite de commandes dans le dossier et tape `node server.js` (Ollama doit déjà tourner).

21. Tu devrais voir :

    &#x20;   ```
   ⚡ TimeFlow → http://localhost:3000/app

    ⚡ TimeFlow → http://localhost:3000/app

    ```

22. Ouvre ton navigateur sur \*\*http://localhost:3000\*\*

    \\---

    ## 🔓 Étape 5 — Se connecter

23. Sur la page d'accueil de l'app, colle ton \*\*ID client\*\* et ton \*\*Code secret\*\* (ceux de l'étape 3.4) → \*\*Connecter\*\*.
24. Tu es redirigé vers Google. Choisis ton compte.
25. Un écran \*\*« Google n'a pas validé cette application »\*\* apparaît → clique \*\*Paramètres avancés\*\* → \*\*Accéder à TimeFlow (dangereux)\*\*.

    > C'est normal : l'app est « non vérifiée » parce qu'elle tourne chez toi, pour toi. Aucun risque.

26. Autorise l'accès à ton agenda → tu reviens dans l'app, \*\*connecté\*\*. 🎉

    \\---

    ## 🧭 Comment utiliser TimeFlow

\* \*\*Calendrier\*\* : vue semaine. Clique sur un créneau vide pour créer un événement ; clique sur un événement pour le modifier ou le supprimer. Tout est synchronisé avec Google.
\* \*\*Bouton « Tout planifier »\*\* (en haut à droite) : lance le moteur — il remplit tes 2 prochaines semaines (habitudes → focus → tâches) autour de tes réunions.
\* \*\*Priorités\*\* : visualise tâches \\\& habitudes rangées en colonnes P1 → P4.
\* \*\*Focus Time\*\* : règle la durée d'un bloc de concentration ; il s'ajoute automatiquement chaque jour ouvré.
\* \*\*Habitudes\*\* : ajoute des routines (sport, révisions…) avec jours, plage horaire et priorité. Utilise les \*\*modèles rapides\*\* pour aller vite.
\* \*\*Tâches\*\* : ajoute une tâche avec durée totale, échéance et priorité ; elle est \*\*découpée en sessions\*\* et placée avant la deadline.
\* \*\*Pauses \\\& marges\*\* : insère des pauses quand deux événements sont trop collés.
\* \*\*Assistant IA\*\* : écris en français, ex. \*« bloque 2h de sport demain à 18h »\*, \*« ajoute une révision de maths de 3h avant vendredi »\*, \*« qu'est-ce que j'ai cette semaine ? »\*. Il crée/modifie réellement tes événements.
\* \*\*Mémoire\*\* : note tes objectifs, contraintes et préférences. L'IA s'en sert pour mieux planifier.
\* \*\*Réglages\*\* : modèle Ollama, fuseau, heures de travail vs heures perso, jours sans réunion.

  > Le moteur \\\\\\\\\\\\\\\*\\\\\\\\\\\\\\\*replanifie automatiquement\\\\\\\\\\\\\\\*\\\\\\\\\\\\\\\* : si tu ajoutes une réunion dans Google, les blocs gérés par TimeFlow se réorganisent autour (vérification toutes les minutes côté app, et toutes les 5 min côté serveur ; planning complet chaque dimanche 20h).

  \\---

  ## 🔒 Étape importante — Sécurité

  Tes anciens identifiants Google (le `client\\\\\\\\\\\\\\\_secret` et le `refresh\\\\\\\\\\\\\\\_token` présents dans tes fichiers `config.json` / `tokens.json`) ont été partagés dans notre conversation. Par précaution, \*\*régénère-les\*\* :

1. \*\*Réinitialiser le secret\*\* : Google Cloud Console → \*\*Identifiants\*\* → ouvre ton ID client OAuth → \*\*Réinitialiser le code secret\*\* (puis recolle le nouveau secret dans l'app).
2. \*\*Révoquer l'ancien accès\*\* : va sur \*\*https://myaccount.google.com/permissions\*\* → retire l'autorisation de l'ancienne app, puis reconnecte-toi proprement via TimeFlow.

   C'est rapide et ça garantit que personne d'autre ne peut utiliser tes anciennes clés.

   \\---

   ## 🛠️ Dépannage

|Problème|Solution|
|-|-|
|\*\*`redirect\\\\\\\\\\\\\\\_uri\\\\\\\\\\\\\\\_mismatch`\*\*|L'URI dans Google Cloud doit être \*\*exactement\*\* `http://localhost:3000/oauth/callback`. Re-vérifie (pas de `/` final).|
|\*\*`accès bloqué : app non validée`\*\*|Ajoute ton Gmail dans \*\*Utilisateurs test\*\* (étape 3.3.4).|
|\*\*L'assistant IA ne répond pas\*\*|Ollama n'est pas lancé. Ouvre un terminal et tape `ollama serve`, ou relance `start.bat`. Vérifie que le modèle dans Réglages correspond à celui téléchargé.|
|\*\*`port 3000 déjà utilisé`\*\*|Une ancienne instance tourne. Ferme les fenêtres noires, ou redémarre le PC, puis relance.|
|\*\*Le calendrier semble vide / "Mode démonstration"\*\*|Le serveur n'est pas démarré, ou tu as ouvert `app.html` en double-clic (file://). Passe \*\*toujours par http://localhost:3000\*\*.|
|\*\*Page blanche\*\*|Vérifie que `app.html` est bien dans le \*\*même dossier\*\* que `server.js`.|

\\---

## 🌐 Aller plus loin — Liens de réservation publics

En local, l'onglet \*\*Liens de réservation\*\* calcule et affiche tes créneaux libres. Pour qu'une \*\*autre personne\*\* réserve via une page web (comme Calendly/Reclaim), l'app doit être \*\*accessible en ligne\*\*. Deux options simples plus tard :

\* héberger `server.js` sur un petit serveur (Railway, Render, un VPS…) ;
\* ou utiliser un tunnel temporaire (`ngrok http 3000`) — pense alors à \*\*ajouter l'URL HTTPS générée dans les URI de redirection\*\* Google.

C'est une évolution « v2 » : tout le reste de l'app fonctionne dès maintenant en local.

\\---

Bon planning ! ⚡


