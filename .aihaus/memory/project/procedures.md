# Procedures

## Development closeout

1. Run affected checks.
2. Run broader repository checks required by the Definition of Done.
3. Record commands, exit codes, and degraded checks.
4. Review the diff and update durable memory only when warranted.

- Verified: checagens disponíveis na raiz — `npm run test:unit` (Vitest backend + Vitest frontend), `npm run test:e2e` (`scripts/run-e2e.mjs`) e `npm run test:all` (ambos em sequência); a checagem de tipos do frontend é `npm --prefix frontend run test:typecheck`. Source: `package.json` (reviewed 824aace).
- Verified: o build completo é `npm run build:all` (tsc no backend, `tsc && vite build` no frontend). Source: `package.json` (reviewed 824aace).

## Operational procedures

- Verified: subir o stack completo — `npm run docker:up` (`docker compose up -d --build`); parar sem perder dados — `npm run docker:down`; logs — `npm run docker:logs`. Source: `package.json` (reviewed 824aace).
- Verified: destrutivos, exigem confirmação explícita — `npm run docker:reset` (apaga volumes de banco e uploads) e `npm run db:reset` (`prisma migrate reset --force`). Source: `package.json` (reviewed 824aace).
- Verified: na inicialização do container, o backend roda `prisma migrate deploy` com até 10 tentativas (2 s de intervalo), aborta se falhar, e executa o seed idempotente só quando `RUN_SEED=true` (padrão `false`); em produção o seed exige `ADMIN_SEED_PASSWORD`/`OPERATIONAL_SEED_PASSWORD` (>= 12) e não cria demo (DOC-32). Source: `backend/docker-entrypoint.sh`, `backend/prisma/seed.ts` (reviewed 60daa31).
- Verified: qualquer `docker compose` (inclusive `down`/`logs`) exige `JWT_SECRET` no `.env` (DOC-33). `npm run test:e2e` não precisa de variáveis: o runner gera `JWT_SECRET` e senhas do seed aleatórios. Source: `docker-compose.yml`, `scripts/run-e2e.mjs` (reviewed 60daa31).
- Verified: conflito de portas no host é resolvido sobrescrevendo `FRONTEND_PORT`, `BACKEND_PORT` e `POSTGRES_PORT` na chamada do Docker Compose. Source: `README.md` (reviewed 824aace).
- Verified: tickets do Linear são lidos/atualizados com `orca linear ...` (issue atual, mudança de status, comentário de conclusão com link do PR). Source: `.claude/skills/orca-linear/SKILL.md` (reviewed 824aace).
- Verified: produção = compose base + `docker-compose.prod.yml` (`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait`, ou só `docker compose` com o `COMPOSE_FILE` do `.env.production.example`); só o `caddy` publica 80/443, `DOMAIN` e `POSTGRES_PASSWORD` são obrigatórias, `FRONTEND_URL` vem de `DOMAIN` e `GOOGLE_REDIRECT_URI` fica no `.env` (Google parcial derruba o boot). Mudou o `deploy/Caddyfile`: `restart caddy`. Source: `docker-compose.prod.yml`, `.env.production.example`, `backend/src/config/env.ts` (reviewed 7709382).
- Verified: backup de produção — `scripts/backup.sh [nome]` grava `<BACKUP_ROOT>/<nome>/{db.dump,uploads.tar.gz}` (padrão `/var/backups/docsobs/AAAA-MM-DD`, `umask 077`), publica só completo, mantém os `KEEP`=7 diretórios `AAAA-MM-DD` mais recentes e funciona com o backend parado; cron às 02:30 com log em `/home/ubuntu/docsobs-backup.log`. Source: `scripts/backup.sh`, `docs/deploy/oracle-cloud.md` (reviewed 7709382).
- Verified: restauração (destrutiva; exige digitar `RESTAURAR` ou `--yes`) — `scripts/restore.sh <dir>` salva antes `<BACKUP_ROOT>/pre-restore-AAAAMMDD-HHMMSS` (fora da retenção; desfazer = restaurá-lo), carrega o dump em banco temporário que substitui o ativo, repõe os anexos e sobe o backend. Teste mensal numa cópia sem Caddy: `COMPOSE_PROJECT_NAME=docsobs-teste BACKUP_ROOT=/tmp/docsobs-teste`, `up -d --wait postgres backend`, `restore.sh`, conferir, `down -v` só desse projeto. Source: `scripts/restore.sh`, `docs/deploy/oracle-cloud.md` (reviewed 7709382).
- Verified: validar esses scripts no Windows (Git Bash) exige `MSYS_NO_PATHCONV=1` só na chamada do script (senão `/app/uploads` vira caminho do Windows) e env file no formato `C:/...` (`COMPOSE_ENV_FILES`); sob essa variável o `curl -o /dev/null` reporta 0 bytes baixados. Teste arm64 local: `DOCKER_DEFAULT_PLATFORM=linux/arm64` + `docker pull --platform linux/arm64` das imagens base (e devolver as tags com `--platform linux/amd64` depois); sob QEMU o backend leva ~70 s e estoura o healthcheck. Source: execução local de 2026-10-26 (tarefa T-261026-8742d6).
- Inferred candidate: o histórico Git mostra o fluxo branch por tarefa → PR → merge em `main` (ex.: PR #11 e #12); não há regra de branch documentada.
