#!/usr/bin/env bash
# Restauração de um backup do DocsObs em produção (DOC-46).
# DESTRUTIVO: o banco e os anexos atuais são substituídos pelo conteúdo do backup.
#
# Uso (na raiz do clone, no servidor):
#   scripts/restore.sh /var/backups/docsobs/AAAA-MM-DD          # pede para digitar RESTAURAR
#   scripts/restore.sh /var/backups/docsobs/AAAA-MM-DD --yes    # sem pergunta
#
# O dump é restaurado num banco temporário e só então troca de nome com o banco
# ativo, que fica guardado como <POSTGRES_DB>_anterior até a próxima restauração.
# Assim o resultado é idêntico ao backup (sem tabelas de migrations mais novas) e
# um dump inválido não toca o banco ativo.
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

trap 'echo "[restore] FALHOU (veja a última etapa acima). O backend ficou parado; após corrigir, suba com: ${compose[*]} up -d --wait backend" >&2' ERR

echo "[restore] 1/5 parando o backend"
"${compose[@]}" stop backend

echo "[restore] 2/5 restaurando o dump em banco temporário"
"${compose[@]}" exec -T postgres sh -c '
  dropdb -U "$POSTGRES_USER" --if-exists "${POSTGRES_DB}_restore" &&
  createdb -U "$POSTGRES_USER" "${POSTGRES_DB}_restore" &&
  pg_restore -U "$POSTGRES_USER" -d "${POSTGRES_DB}_restore" --no-owner --single-transaction --exit-on-error' \
  < "$backup_dir/db.dump"

echo "[restore] 3/5 trocando o banco ativo pelo restaurado"
"${compose[@]}" exec -T postgres sh -c '
  dropdb -U "$POSTGRES_USER" --if-exists "${POSTGRES_DB}_anterior" &&
  psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q -c "
    ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"${POSTGRES_DB}_anterior\";
    ALTER DATABASE \"${POSTGRES_DB}_restore\" RENAME TO \"$POSTGRES_DB\";"'

echo "[restore] 4/5 substituindo os anexos"
"${compose[@]}" run --rm --no-deps -T --entrypoint sh backend -c \
  'find /app/uploads -mindepth 1 -delete && tar -C /app/uploads -xzf -' \
  < "$backup_dir/uploads.tar.gz"

echo "[restore] 5/5 subindo o backend (aplica migrations pendentes)"
"${compose[@]}" up -d --wait backend

echo "[restore] concluído a partir de $backup_dir."
