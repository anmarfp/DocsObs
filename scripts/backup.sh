#!/usr/bin/env bash
# Backup diário do DocsObs em produção (DOC-46): dump do PostgreSQL + anexos.
#
# Uso (na raiz do clone, no servidor): scripts/backup.sh
# Cron: 30 2 * * * /home/ubuntu/DocsObs/scripts/backup.sh >> /home/ubuntu/docsobs-backup.log 2>&1
#
# Grava <BACKUP_ROOT>/AAAA-MM-DD/{db.dump,uploads.tar.gz} e mantém só os KEEP
# backups mais recentes. Sai com código diferente de 0 em qualquer falha.
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/docsobs}"
KEEP="${KEEP:-7}"

cd "$(dirname "$0")/.."
compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

dest="$BACKUP_ROOT/$(date +%F)"
# Monta o backup ao lado e só o publica completo: uma falha não deixa par
# dump/anexos inconsistente nem diretório vazio contando na retenção.
work="$dest.partial"
rm -rf "$work"
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

echo "[backup] $(date '+%F %T') iniciando em $dest"

"${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$work/db.dump"
"${compose[@]}" exec -T backend tar -C /app/uploads -czf - . > "$work/uploads.tar.gz"

rm -rf "$dest"
mv "$work" "$dest"

# Retenção por nome (AAAA-MM-DD ordena cronologicamente).
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '????-??-??' | sort | head -n -"$KEEP" | xargs -r rm -rf

echo "[backup] concluído: $(du -sh "$dest" | cut -f1) em $dest"
