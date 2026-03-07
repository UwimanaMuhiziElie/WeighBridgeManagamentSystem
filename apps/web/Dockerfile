FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci

COPY apps ./apps
COPY packages ./packages

EXPOSE 5174

CMD ["npm", "run", "dev", "-w", "apps/web", "--", "--host", "0.0.0.0", "--port", "5174"]
