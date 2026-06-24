#!/bin/sh
# Wervik container entrypoint.
#
# Ensures the SQLite DB + uploads dir exist on the mounted volume, applies
# pending Prisma migrations, seeds default settings/screens/profiles/agents
# (the seed upserts, so re-running on every boot is safe), then hands off to
# the main process (CMD).

set -e

DATA_DIR="${DATA_DIR:-/data}"
DB_PATH="${DB_PATH:-$DATA_DIR/wervik.db}"
export DATABASE_URL="file:$DB_PATH"
export UPLOADS_DIR="${UPLOADS_DIR:-$DATA_DIR/uploads}"

mkdir -p "$DATA_DIR" "$UPLOADS_DIR"

# Apply any pending migrations (creates the DB file on first run).
echo "[wervik] running prisma migrate deploy…"
npx prisma migrate deploy

# Seed defaults. The seed uses upserts, so it is safe to run every boot and
# will not overwrite values you changed in Admin -> Settings.
echo "[wervik] seeding defaults…"
node dist/seed.js || echo "[wervik] seed step skipped"

echo "[wervik] starting app on port ${PORT:-4000}…"
exec "$@"
