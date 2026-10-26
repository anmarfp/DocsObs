#!/usr/bin/env bash
# Restauração de um backup do DocsObs em produção (DOC-46).
# DESTRUTIVO: o banco e os anexos atuais são substituídos pelo conteúdo do backup.
#
# Uso (na raiz do clone, no servidor):
#   scripts/restore.sh /var/backups/docsobs/AAAA-MM-DD          # pede para digitar RESTAURAR
#   scripts/restore.sh /var/backups/docsobs/AAAA-MM-DD --yes    # sem pergunta
#
# Antes de mudar qualquer coisa, o estado atual é salvo com scripts/backup.sh em
# <BACKUP_ROOT>/pre-restore-AAAAMMDD-HHMMSS (fora da retenção): para desfazer,
# restaure esse diretório. O dump é carregado num banco temporário que só então
# substitui o ativo, então o resultado é idêntico ao backup (sem tabelas de
# migrations mais novas) e um dump inválido não toca o banco ativo.
set -euo pipefail

backup_dir="${1:?uso: scripts/restore.sh <diretório do backup> [--yes]}"
confirm="${2:-}"

for file in db.dump uploads.tar.gz; do
  if [ ! -s "$backup_dir/$file" ]; then
    echo "[restore] $backup_dir/$file ausente ou vazio." >&2
    exit 1
  fi
done
tar -tzf "$backup_dir/uploads.tar.gz" > /dev/null
backup_dir="$(cd "$backup_dir" && pwd)"

cd "$(dirname "$0")/.."
compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

if [ "$confirm" != "--yes" ]; then
  echo "ATENÇÃO: o banco e os anexos atuais serão substituídos por $backup_dir."
  read -r -p "Digite RESTAURAR para continuar: " answer
  if [ "$answer" != "RESTAURAR" ]; then
    echo "[restore] cancelado."
    exit 1
  fi
fi

snapshot="pre-restore-$(date +%Y%m%d-%H%M%S)"
echo "[restore] 1/6 salvando o estado atual em ${BACKUP_ROOT:-/var/backups/docsobs}/$snapshot"
scripts/backup.sh "$snapshot"

trap 'echo "[restore] FALHOU (veja a última etapa acima). O backend pode ter ficado parado. Para voltar ao estado anterior: scripts/restore.sh ${BACKUP_ROOT:-/var/backups/docsobs}/$snapshot --yes" >&2' ERR

echo "[restore] 2/6 parando o backend"
"${compose[@]}" stop backend

echo "[restore] 3/6 restaurando o dump em banco temporário"
"${compose[@]}" exec -T postgres sh -c '
  dropdb -U "$POSTGRES_USER" --if-exists "${POSTGRES_DB}_restore" &&
  createdb -U "$POSTGRES_USER" "${POSTGRES_DB}_restore" &&
  pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" --no-owner --single-transaction --exit-on-error' \
  < "$backup_dir/db.dump"

echo "[restore] 4/6 substituindo o banco ativo pelo restaurado"
"${compose[@]}" exec -T postgres sh -c '
  dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" &&
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q \
    -c "ALTER DATABASE \"${POSTGRES_DB}_restore\" RENAME TO \"$POSTGRES_DB\""'

echo "[restore] 5/6 substituindo os anexos"
"${compose[@]}" run --rm --no-deps -T --entrypoint sh backend -c \
  'find /app/uploads -mindepth 1 -delete && tar -C /app/uploads -xzf -' \
  < "$backup_dir/uploads.tar.gz"

echo "[restore] 6/6 subindo o backend (aplica migrations pendentes)"
"${compose[@]}" up -d --wait backend

echo "[restore] concluído a partir de $backup_dir. Estado anterior salvo em ${BACKUP_ROOT:-/var/backups/docsobs}/$snapshot."
