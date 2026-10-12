# Stage 1: Build de la aplicación
FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/

RUN pnpm run build
RUN pnpm prune --prod

# Stage 2: Runtime de Producción
FROM node:22-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production

RUN apk add --no-cache dumb-init wget

RUN mkdir -p /temp/comics /temp/covers \
    && chown -R node:node /temp /usr/src/app

COPY --chown=node:node package.json ./
COPY --chown=node:node --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=builder /usr/src/app/dist ./dist

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
