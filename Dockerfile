FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN node scripts/copy-vendor.js
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "src/server.js"]
