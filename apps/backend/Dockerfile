# apps/backend/Dockerfile
# syntax=docker/dockerfile:1

# ---------- Base (build tooling only where needed) ----------
FROM node:20-bookworm-slim AS base
WORKDIR /app

# If you ever add native deps, build tooling is here (safe to keep)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# ---------- Deps (with dev deps for dev/build) ----------
FROM base AS deps
WORKDIR /app

# Copy only manifests first for better Docker cache
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci

# ---------- DEV target ----------
FROM deps AS dev
WORKDIR /app
ENV NODE_ENV=development

# Now bring full source
COPY apps ./apps
COPY packages ./packages

EXPOSE 3001
CMD ["npm", "run", "dev", "-w", "apps/backend"]

# ---------- Build target (compiles TS) ----------
FROM deps AS build
WORKDIR /app

COPY apps ./apps
COPY packages ./packages

# Build shared first (safe), then backend
RUN npm run build -w packages/shared && npm run build -w apps/backend

# ---------- Prod deps (prod-only node_modules) ----------
FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci --omit=dev

# ---------- PROD runtime ----------
FROM node:20-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production

# node_modules from prod-deps
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Copy only what runtime needs
RUN mkdir -p apps/backend packages/shared
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/backend/dist ./apps/backend/dist

COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

EXPOSE 3001
CMD ["node", "apps/backend/dist/server.js"]
