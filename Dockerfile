# TimeFlow — image serveur pour hébergement (Render / Fly.io / Railway…)
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js app.html ./
COPY vendor ./vendor
COPY models ./models
# Données : éphémères sur l'hébergeur (la persistance réelle passe par la synchro Supabase).
ENV TF_DATA_DIR=/app/data
RUN mkdir -p /app/data
# PORT est fourni par l'hébergeur ; TF_PUBLIC_URL = l'URL publique (à définir dans les variables d'env de l'hébergeur).
EXPOSE 3000
CMD ["node", "server.js"]
