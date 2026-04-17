# ─────────────────────────────────────────────
# Étape 1 : Build — compilation du frontend React/Vite
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copie des fichiers de dépendances en premier pour profiter du cache Docker
COPY package.json package-lock.json* ./
RUN npm install

# Copie du reste du code source puis compilation
COPY . .
RUN npm run build

# ─────────────────────────────────────────────
# Étape 2 : Production — service des fichiers statiques via Nginx
# ─────────────────────────────────────────────
FROM nginx:alpine

# Copie uniquement le dossier dist généré à l'étape précédente
COPY --from=builder /app/dist /usr/share/nginx/html

# Exposition du port HTTP
EXPOSE 80

# Nginx démarre automatiquement (commande par défaut de l'image)
