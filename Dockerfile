# Imagem do jogo de dominó: Node.js puro, sem dependências para instalar.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# Só o necessário para rodar: servidor, regras e arquivos estáticos.
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

# O processo não escreve em disco; roda sem privilégios.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
