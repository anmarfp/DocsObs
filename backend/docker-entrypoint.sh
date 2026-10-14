#!/bin/sh
set -eu

echo "⏳ [Entrypoint] Aguardando banco de dados e aplicando migrações Prisma..."

MAX_RETRIES=10
RETRY_COUNT=0
MIGRATED=0

until [ $RETRY_COUNT -ge $MAX_RETRIES ]; do
  if npx prisma migrate deploy; then
    echo "✅ [Entrypoint] Migrações Prisma aplicadas com sucesso!"
    MIGRATED=1
    break
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "⚠️ [Entrypoint] Tentativa $RETRY_COUNT de $MAX_RETRIES falhou. Aguardando 2s..."
    sleep 2
  fi
done

if [ $MIGRATED -ne 1 ]; then
  echo "❌ [Entrypoint] Falha ao aplicar migrações após $MAX_RETRIES tentativas. Abortando inicialização."
  exit 1
fi

# Executa seed apenas se RUN_SEED for "true"
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "🌱 [Entrypoint] Executando seed inicial (idempotente)..."
  if node dist/prisma/seed.js; then
    echo "✅ [Entrypoint] Seed concluído com sucesso!"
  else
    echo "❌ [Entrypoint] Falha crítica na execução do seed. Abortando."
    echo "   Veja a mensagem acima. Em produção o seed exige ADMIN_SEED_PASSWORD e OPERATIONAL_SEED_PASSWORD; use RUN_SEED=false para pular."
    exit 1
  fi
else
  echo "ℹ️ [Entrypoint] RUN_SEED não habilitado. Pulando etapa de seed."
fi

echo "🚀 [Entrypoint] Iniciando servidor DocsObs na porta ${PORT:-3001}..."
exec "$@"
