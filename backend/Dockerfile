# ==============================================================================
# DOCSOBS BACKEND — Dockerfile Multi-Stage (Node.js 20 Alpine)
# ==============================================================================

# ---- Stage 1: Build & Prisma Generate ----
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY . .
RUN npm run build

# ---- Stage 2: Imagem Final de Produção ----
FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache openssl wget

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Instala apenas dependências de runtime em /app/node_modules (--omit=dev --omit=optional
# evita reificar devDependencies e peerDependencies opcionais de dev como typescript)
# e instala a CLI do Prisma em prefixo separado (-g /usr/local) na versão declarada no
# package.json, pois npm install local com --omit=dev --omit=optional ignora pacotes
# declarados em devDependencies.
RUN npm ci --omit=dev --omit=optional && npm install -g "prisma@$(node -p "require('./package.json').devDependencies.prisma")"

# Copia artefatos compilados do builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Cria diretório de uploads e define permissões para o usuário node
RUN mkdir -p /app/uploads && chown -R node:node /app

# Copia e normaliza entrypoint
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3001
ENV UPLOAD_DIR=/app/uploads

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3001/api/v1/health || exit 1

USER node

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/src/server.js"]
