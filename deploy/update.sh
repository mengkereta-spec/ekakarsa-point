#!/usr/bin/env sh
# Tarik kode terbaru dari GitHub lalu build & jalankan ulang (mode Docker).
# Pemakaian:  ./deploy/update.sh            (PostgreSQL di VPS)
#             ./deploy/update.sh supabase   (database Supabase)
set -eu
cd "$(dirname "$0")/.."
COMPOSE_FILE=docker-compose.yml
[ "${1:-}" = "supabase" ] && COMPOSE_FILE=docker-compose.supabase.yml
git pull --ff-only
docker compose -f "$COMPOSE_FILE" up -d --build
docker image prune -f >/dev/null
docker compose -f "$COMPOSE_FILE" ps
