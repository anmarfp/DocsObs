---
id: T-261014-7f7d1f-doc-36-indices-no-schema-prisma
room: feature
external_id: "DOC-36"
created: 2026-10-14T14:33:21.612Z
---

# Goal

DOC-36 indices no schema Prisma

## Acceptance

- [ ] schema.prisma declara @@index nas 8 FKs e nas colunas quentes (Document isArchived+status, expirationDate, createdAt; AuditLog timestamp, documentId; GCalSyncLog documentId+lastSyncedAt)
- [ ] Migration nova aplica os indices e pg_trgm + GIN trigram em documents.title
- [ ] prisma validate/generate e suites verdes
- [ ] EXPLAIN ANALYZE com volume representativo documentado (degradado se Docker indisponivel)

## Context

- Linear DOC-36 (P0-5). Unicos indices atuais: users.email e document_categories.name.
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/prisma/schema.prisma, backend/prisma/migrations/<novo>/migration.sql, docs (medicao), backend/tests/** se aplicavel

## Business-rule gaps

- none

## Log

- 2026-10-14 ingerido do Linear DOC-36 pelo orquestrador.

## Evidence
