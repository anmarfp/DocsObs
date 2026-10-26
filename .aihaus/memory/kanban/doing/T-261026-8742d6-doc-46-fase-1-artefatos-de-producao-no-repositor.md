---
id: T-261026-8742d6-doc-46-fase-1-artefatos-de-producao-no-repositor
room: feature
created: 2026-10-26T14:25:55.757Z
---

# Goal

DOC-46 fase 1: o repositório passa a ter tudo o que o deploy de produção na Oracle Cloud precisa (override do compose com Caddy/HTTPS e sem portas públicas de banco/API, exemplo de `.env` de produção, backup e restauração), validado localmente e em `linux/arm64`. A implantação na VM (fases 0 e 2-6) segue na tarefa-mãe `T-261023-97bf04`.

## Acceptance

- [ ] `docker-compose.prod.yml` sobre o compose base publica no host apenas as portas 80 e 443 do `caddy`; `postgres`, `backend` e `frontend` ficam sem porta de host
- [ ] O override recusa subir sem `DOMAIN` e sem `POSTGRES_PASSWORD` explícita
- [ ] Stack de produção local (`DOMAIN=localhost`) sobe com `--wait`; `https://localhost/` e `https://localhost/api/v1/health` respondem via Caddy e as portas 5432, 3001 e 3000 recusam conexão no host
- [ ] As imagens de `backend` e `frontend` constroem em `linux/arm64` e o backend arm64 aplica as migrations, roda o seed e responde ao health
- [ ] `scripts/backup.sh` grava `db.dump` e `uploads.tar.gz` em `<BACKUP_ROOT>/AAAA-MM-DD/`, mantém só os 7 mais recentes e sai com código diferente de 0 em falha
- [ ] `scripts/restore.sh` exige confirmação explícita e restaura banco e anexos (ida e volta: documento com anexo apagado volta após o restore)
- [ ] `.env.production.example` lista as variáveis de produção sem valores reais e o README aponta para o plano e o runbook
- [ ] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Tarefa-mãe: `.aihaus/memory/kanban/todo/T-261023-97bf04-doc-46-deploy-na-oracle-cloud-always-free.md` (Linear DOC-46). Plano: `docs/deploy/oracle-cloud.md` (Fase 1, itens 1-6 e 8), base `main` 5d09de3.
- Regras/decisões: DOC-32 (seed exige senhas em produção, `backend/prisma/seed.ts`), DOC-33 (`JWT_SECRET` obrigatório no compose, `docker-compose.yml:43`), DOC-44 (`GOOGLE_TOKEN_ENCRYPTION_KEY`), ADR-009/RN-007 (Google Agenda).
- Desvio do plano: `GOOGLE_REDIRECT_URI` não é derivada de `DOMAIN` no override. `backend/src/config/env.ts` (superRefine, bloco `googleMap`) aborta o boot com a integração Google parcial, e o primeiro deploy (Fase 4) acontece antes do cliente OAuth existir (Fase 5). Ela fica no `.env`, com o valor exato documentado no exemplo. `FRONTEND_URL` é derivada de `DOMAIN`.
- `POSTGRES_PASSWORD` entra na `DATABASE_URL` sem escape (`docker-compose.yml:42`): o exemplo pede valor alfanumérico.
- Mode: normal. Autor Claude; judgment pass em contexto separado (Codex, outra família de modelo, quando disponível).
- Branch `anmarfp/doc-46-fase-1`, base 5d09de3.

## Owned files

- docker-compose.prod.yml, deploy/Caddyfile, .env.production.example, scripts/backup.sh, scripts/restore.sh, README.md, docs/deploy/oracle-cloud.md
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**, .aihaus/memory/project/procedures.md, .aihaus/memory/project/deployment.md

## Business-rule gaps

- none

## Log

- 2026-10-26 criada pelo orquestrador como filha da DOC-46 (fase 1 é entregável sem a VM; fases 0 e 2-6 dependem das contas do dono).

## Evidence
