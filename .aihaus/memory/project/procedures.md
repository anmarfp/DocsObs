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
- Inferred candidate: o histórico Git mostra o fluxo branch por tarefa → PR → merge em `main` (ex.: PR #11 e #12); não há regra de branch documentada.
