# syntax=docker/dockerfile:1
#
# Wervik — single-image build (Node backend serving the React frontend).
# Multi-stage so the final image stays small (no devDeps / source).
#
#   docker compose up -d --build
#
# The app listens on $PORT inside the container (default 4000). The compose
# file maps host port 9009 -> container 4000.

# ---------------------------------------------------------------------------
# Stage 1 — build the React frontend
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /build/frontend

# Install deps first (cached unless package files change).
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

# Build the production bundle (emits frontend/dist).
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — build the Node backend (TS -> dist) + generate Prisma client
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS backend-build
WORKDIR /build/backend

# OpenSSL is needed by Prisma's query engine on Debian slim.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

COPY backend/ ./

# Generate the Prisma client for the schema shipped with the code.
RUN npx prisma generate

# Compile the backend (src -> dist).
RUN npm run build

# Compile the TS seeds (prisma/seed.ts -> dist/seed.js, seed-menu.ts ->
# dist/seed-menu.js) so they can run in the runtime image without tsx.
# seed.js runs at container start; seed-menu.js is the on-demand menu reset:
#   docker exec wervik node dist/seed-menu.js --yes
RUN npx tsc prisma/seed.ts prisma/seed-menu.ts \
    --outDir dist \
    --target ES2020 \
    --module ESNext \
    --moduleResolution Bundler \
    --esModuleInterop \
    --skipLibCheck

# ---------------------------------------------------------------------------
# Stage 3 — minimal runtime image
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4000
# SQLite file + uploaded product images live under /data (a mounted volume),
# so they survive container rebuilds.
ENV DATABASE_URL=file:/data/wervik.db
ENV UPLOADS_DIR=/data/uploads

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
    && npm install -g prisma@5 \
    && mkdir -p /data/uploads

# Production dependencies only.
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

# Compiled backend (incl. seed) + schema/migrations (needed by migrate deploy).
COPY --from=backend-build /build/backend/dist ./dist
COPY --from=backend-build /build/backend/prisma ./prisma
# Prisma generated client (not part of the npm package).
COPY --from=backend-build /build/backend/node_modules/.prisma ./node_modules/.prisma
COPY --from=backend-build /build/backend/node_modules/@prisma ./node_modules/@prisma

# Frontend production bundle (served by the backend).
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

# Entrypoint: run pending migrations + seed defaults, then start.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
