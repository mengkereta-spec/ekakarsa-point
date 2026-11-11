# ---- Tahap build: pasang semua dependensi, build CSS Tailwind & salin Font Awesome ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci
COPY tailwind.config.js ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---- Tahap runtime: hanya dependensi production ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Jakarta
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY db ./db
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "src/server.js"]
