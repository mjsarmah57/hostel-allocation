FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# bcrypt ships prebuilt binaries for alpine/musl; no build tools needed.
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p uploads && chown -R node:node /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:4000/health || exit 1
# Apply pending SQL migrations, then start the API.
CMD ["sh", "-c", "node scripts/migrate.js && node src/server.js"]
