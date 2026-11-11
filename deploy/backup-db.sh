#!/usr/bin/env sh
# Backup database PostgreSQL di Docker ke folder backups/ (simpan 14 hari terakhir).
# Jadwalkan harian:  crontab -e  lalu tambahkan
#   0 2 * * * /home/USER/ekakarsa-point/deploy/backup-db.sh >> /home/USER/ekakarsa-point/backups/backup.log 2>&1
# Pulihkan:  gunzip -c backups/FILE.sql.gz | docker compose exec -T db psql -U ekakarsa -d ekakarsa
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
FILE="backups/ekakarsa-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T db pg_dump -U ekakarsa -d ekakarsa --no-owner --clean --if-exists | gzip > "$FILE"
find backups -name 'ekakarsa-*.sql.gz' -mtime +14 -delete
echo "Backup tersimpan: $FILE"
