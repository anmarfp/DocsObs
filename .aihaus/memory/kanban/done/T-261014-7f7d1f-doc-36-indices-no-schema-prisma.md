---
id: T-261014-7f7d1f-doc-36-indices-no-schema-prisma
room: feature
external_id: "DOC-36"
created: 2026-10-14T14:33:21.612Z
---

# Goal

DOC-36 indices no schema Prisma

## Acceptance

- [x] schema.prisma declara @@index nas 8 FKs e nas colunas quentes (Document isArchived+status, expirationDate, createdAt; AuditLog timestamp, documentId; GCalSyncLog documentId+lastSyncedAt)
- [x] Migration nova aplica os indices e pg_trgm + GIN trigram em documents.title
- [x] prisma validate/generate e suites verdes
- [x] EXPLAIN ANALYZE com volume representativo documentado (degradado se Docker indisponivel)

## Context

- Linear DOC-36 (P0-5). Unicos indices atuais: users.email e document_categories.name.
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/prisma/schema.prisma, backend/prisma/migrations/<novo>/migration.sql, docs (medicao), backend/tests/** se aplicavel

## Business-rule gaps

- none

## Log

- 2026-10-14 ingerido do Linear DOC-36 pelo orquestrador.
- 2026-10-14 executor (subagente Claude) entregou b3e8e25 (base 38bed91), rebaseado pelo orquestrador para 28ca8ce sobre 7b7403e; scope-check ok.
- 2026-10-14 judgment pass (orquestrador, contexto separado; lentes migration/capacity): full review de 28ca8ce vs 7b7403e. Checkout limpo: prisma validate 0, vitest 200/200 exit 0, build 0, migrate deploy em postgres:16-alpine descartavel 0, migrate diff --from-url --to-schema-datamodel --exit-code 0 (sem drift). Decisao aceita: GIN trigram em 4 colunas (title primeiro) porque a busca real e OR nas 4. Verdict: ship.
- Follow-ups: DOC-37 deve remover document_versions_document_id_idx ao criar @@unique([documentId, versionNumber]); listagem padrao sem LIMIT e _count de auditLogs continua lenta (fora de escopo).

## Evidence

Artifact: .aihaus/memory/evidence/T-261014-7f7d1f-doc-36-indices-no-schema-prisma.json
