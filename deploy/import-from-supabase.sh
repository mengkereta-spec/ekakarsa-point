#!/usr/bin/env sh
# Pindahkan data dari Supabase (skema "ekakarsa") ke PostgreSQL di VPS. Jalankan SEKALI saja.
# Pemakaian:
#   ./deploy/import-from-supabase.sh 'postgresql://USER:PASSWORD@aws-...pooler.supabase.com:5432/postgres'
# URL = "Session pooler" Supabase (Project Settings > Database > Connect), user ekakarsa_app atau postgres.
set -eu
cd "$(dirname "$0")/.."
SRC_URL="${1:?Isi URL database Supabase sebagai argumen pertama}"
mkdir -p backups
DUMP="backups/supabase-$(date +%Y%m%d-%H%M%S).sql"

echo "1/4 Menyalakan database lokal..."
docker compose up -d db
until docker compose exec -T db pg_isready -U ekakarsa -d ekakarsa >/dev/null 2>&1; do sleep 2; done

if docker compose exec -T db psql -U ekakarsa -d ekakarsa -tAc "SELECT 1 FROM pg_namespace WHERE nspname='ekakarsa'" | grep -q 1; then
  echo "Skema ekakarsa sudah ada di database lokal. Import dibatalkan agar data tidak tertimpa."
  exit 1
fi

echo "2/4 Mengunduh data dari Supabase ke $DUMP ..."
docker run --rm postgres:17-alpine pg_dump "$SRC_URL" --schema=ekakarsa --no-owner --no-privileges > "$DUMP"

echo "3/4 Memulihkan ke database lokal..."
docker compose exec -T db psql -U ekakarsa -d ekakarsa -v ON_ERROR_STOP=1 -q \
  -c "ALTER ROLE ekakarsa SET search_path = ekakarsa, public;"
docker compose exec -T db psql -U ekakarsa -d ekakarsa -v ON_ERROR_STOP=1 -q < "$DUMP"

echo "4/4 Menjalankan ulang aplikasi..."
docker compose up -d --force-recreate app
echo "Selesai. Data Supabase sudah ada di VPS (salinan dump: $DUMP)."
