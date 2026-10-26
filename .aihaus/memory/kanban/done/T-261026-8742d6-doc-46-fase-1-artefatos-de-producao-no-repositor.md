---
id: T-261026-8742d6-doc-46-fase-1-artefatos-de-producao-no-repositor
room: feature
created: 2026-10-26T14:25:55.757Z
---

# Goal

DOC-46 fase 1: o repositório passa a ter tudo o que o deploy de produção na Oracle Cloud precisa (override do compose com Caddy/HTTPS e sem portas públicas de banco/API, exemplo de `.env` de produção, backup e restauração), validado localmente e em `linux/arm64`. A implantação na VM (fases 0 e 2-6) segue na tarefa-mãe `T-261023-97bf04`.

## Acceptance

- [x] `docker-compose.prod.yml` sobre o compose base publica no host apenas as portas 80 e 443 do `caddy`; `postgres`, `backend` e `frontend` ficam sem porta de host
- [x] O override recusa subir sem `DOMAIN` e sem `POSTGRES_PASSWORD` explícita
- [x] Stack de produção local (`DOMAIN=localhost`) sobe com `--wait`; `https://localhost/` e `https://localhost/api/v1/health` respondem via Caddy e as portas 5432, 3001 e 3000 recusam conexão no host
- [x] As imagens de `backend` e `frontend` constroem em `linux/arm64` e o backend arm64 aplica as migrations, roda o seed e responde ao health
- [x] `scripts/backup.sh` grava `db.dump` e `uploads.tar.gz` em `<BACKUP_ROOT>/AAAA-MM-DD/`, mantém só os 7 mais recentes e sai com código diferente de 0 em falha
- [x] `scripts/restore.sh` exige confirmação explícita e restaura banco e anexos (ida e volta: documento com anexo apagado volta após o restore)
- [x] `.env.production.example` lista as variáveis de produção sem valores reais e o README aponta para o plano e o runbook
- [x] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

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
- 2026-10-26 implementacao do orquestrador (modo normal, autor Claude) em c1489b1: docker-compose.prod.yml, deploy/Caddyfile, .env.production.example, scripts/backup.sh, scripts/restore.sh, README e plano. Restore por banco temporario + troca de nome em vez de `pg_restore --clean` (que deixaria tabelas de migrations mais novas e quebraria o proximo migrate deploy).
- 2026-10-26 validacao local amd64 (DOMAIN=localhost, projeto docsobs-doc46): up --wait 0, smoke HTTPS via Caddy, 5432/3001/3000 recusadas, backup/retencao/falha, restore com confirmacao e ida e volta. arm64 via DOCKER_DEFAULT_PLATFORM (QEMU): 4 conteineres aarch64, migrate deploy + seed + health ok, backup e restore ok; backend leva ~72 s sob emulacao e estoura o healthcheck (artefato da emulacao).
- 2026-10-26 judgment pass 1 (subagente Claude, contexto separado, somente leitura; Codex indisponivel: CLI nao logado, 401) sobre c1489b1, escopo full: ship-with-changes, 0 CRITICAL/HIGH, 1 MEDIUM (restore reexecutado apagava o _anterior) + 8 LOW. R1 (nginx com IP antigo do backend) testado e nao reproduzido (mesmo IP apos restore e apos force-recreate).
- 2026-10-26 correcoes em 7709382 aplicadas pela sessao autora (desvio do harness, que pede contexto novo para correcoes de revisao): snapshot pre-restore via backup.sh, retencao -print0/-H e KEEP validado, umask 077, anexos por conteiner avulso, Caddy montando a pasta deploy/, COMPOSE_FILE e aspas simples no exemplo, plano alinhado. Reverificado ao vivo: restore, reexecucao e desfazer pelo snapshot voltam os conjuntos esperados; procedimento de teste em projeto separado ok.
- 2026-10-26 por pedido do dono, revisao delegada ao Antigravity em vez de subagente Claude: `agy -p --mode plan --model gemini-4-argon-high` sobre 7709382 (base 5d09de3), escopo full + recheck dos achados 1-9: VERDICT ship, 0 achados, os 9 corrigidos; worktree de revisao sem alteracoes.
- 2026-10-26 DoD em 7709382: `npm run test:all` exit 0 (backend 312/312, frontend 46/46, E2E 20/20). scope-check limpo. Memoria promovida em procedures.md e deployment.md. Fases 0 e 2-6 seguem na tarefa-mae T-261023-97bf04.

## Evidence

Artifact: .aihaus/memory/evidence/T-261026-8742d6-doc-46-fase-1-artefatos-de-producao-no-repositor.json
