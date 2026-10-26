#!/usr/bin/env bash
# Backup diário do DocsObs em produção (DOC-46): dump do PostgreSQL + anexos.
#
# Uso (na raiz do clone, no servidor): scripts/backup.sh [nome]
# Cron: 30 2 * * * /home/ubuntu/DocsObs/scripts/backup.sh >> /home/ubuntu/docsobs-backup.log 2>&1
#
# Grava <BACKUP_ROOT>/<nome>/{db.dump,uploads.tar.gz}; nome padrão AAAA-MM-DD.
# Mantém só os KEEP backups AAAA-MM-DD mais recentes (outros nomes, como os
# pre-restore-* do restore.sh, não são apagados). Sai com código != 0 em falha.
set -euo pipefail
# O dump contém hashes de senha e dados pessoais: só o dono lê.
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/docsobs}"
KEEP="${KEEP:-7}"
if ! [[ $KEEP =~ ^[1-9][0-9]*$ ]]; then
  echo "[backup] KEEP deve ser um inteiro maior que zero (recebido: $KEEP)." >&2
  exit 2
fi

cd "$(dirname "$0")/.."
compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

dest="$BACKUP_ROOT/${1:-$(date +%F)}"
# Monta o backup ao lado e só o publica completo: uma falha não deixa par
# dump/anexos inconsistente nem diretório vazio contando na retenção.
work="$dest.partial"
rm -rf "$work"
mkdir -p "$work"
trap 'rm -rf "$work"' EXIT

echo "[backup] $(date '+%F %T') iniciando em $dest"

"${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$work/db.dump"
# Contêiner avulso do backend: lê o volume de anexos mesmo com o backend parado.
"${compose[@]}" run --rm --no-deps -T --entrypoint tar backend -C /app/uploads -czf - . > "$work/uploads.tar.gz"

rm -rf "$dest"
mv "$work" "$dest"

# Retenção por nome (AAAA-MM-DD ordena cronologicamente).
find -H "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '????-??-??' -print0 |
  sort -z | head -z -n -"$KEEP" | xargs -0 -r rm -rf --

echo "[backup] concluído: $(du -sh "$dest" | cut -f1) em $dest"
