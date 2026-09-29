# Single-container deployment: the API serves the built frontend.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Fallback toolchain: better-sqlite3 ships a prebuilt binary for node 22, so
# this is only used if that download is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY engine/package.json engine/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build:engine \
    && npm run build -w @semcom/web \
    && npm run build -w @semcom/server \
    && npm run test

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY engine/package.json engine/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace @semcom/server --include-workspace-root \
    && apt-get purge -y python3 make g++ || true

COPY --from=build /app/engine/dist engine/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist

# The SQLite file lives here — mount a volume so it survives redeploys.
VOLUME /app/data
ENV DB_PATH=/app/data/semcom.db
ENV PORT=4000
EXPOSE 4000

CMD ["node", "server/dist/index.js"]
