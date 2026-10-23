---
id: T-261023-abc71b-doc-41-daily-digest-uma-vez-por-dia-civil-e-sem-
room: feature
external_id: "DOC-41"
created: 2026-10-23T14:07:14.119Z
---

# Goal

DOC-41: o daily digest sai no maximo uma vez por dia civil em `APP_TIMEZONE`, mesmo com varias replicas, e nao sai quando nao ha pendencias.

## Acceptance

- [ ] Duas execucoes do job diario no mesmo dia civil em `APP_TIMEZONE`, em sequencia ou em paralelo, enviam o digest uma unica vez
- [ ] Com 0 documentos pendentes o digest nao e enviado, coberto por teste
- [ ] A migration nova aplica em banco vazio via `prisma migrate deploy` (stack E2E)
- [ ] `npm run test:unit`, `npm --prefix frontend run test:typecheck`, `npm run build:all` e `npm run test:e2e` verdes
- [ ] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Linear: DOC-41 (https://linear.app/docsob/issue/DOC-41). Mode: normal.
- Decisao do dono (2026-10-23, sessao do orquestrador): nao enviar o digest com 0 pendencias.
- Regra atual: `.aihaus/memory/project/business-rules.md:21` (job diario 00:00 em `APP_TIMEZONE`, `pg_try_advisory_xact_lock`, DOC-27/DOC-31).
- Worktree Orca `doc-41-digest-idempotente`, branch `anmarfp/doc-41-digest-idempotente`, base `0b218b0`.

## Owned files

- backend/src/services/scheduler.ts, backend/src/services/cronService.ts, backend/src/services/notificationService.ts
- backend/prisma/schema.prisma, backend/prisma/migrations/<nova>/
- backend/tests/**
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**, .aihaus/memory/project/business-rules.md (orquestrador)

## Business-rule gaps

- none (digest com 0 pendencias respondido pelo dono em 2026-10-23)

## Log

- 2026-10-23 criado pelo orquestrador a partir do Linear DOC-41.

## Evidence
