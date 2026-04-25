# Stage 1: Build e testes
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar apenas package files primeiro (cache de camadas)
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Runtime
FROM node:22-alpine

# Criar usuário não-root (segurança)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copiar dependências do stage anterior
COPY --from=builder /app/node_modules ./node_modules
COPY src/ ./src/

# Não rodar como root
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]