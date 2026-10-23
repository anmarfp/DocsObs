---
id: T-261023-bf4a25-doc-42-renovacao-sincroniza-o-evento-no-google-a
room: feature
external_id: "DOC-42"
created: 2026-10-23T14:11:06.464Z
---

# Goal

DOC-42: renovar um documento atualiza o evento existente no Google Agenda (Opcao A).

## Acceptance

- [ ] Renovar um documento com vencimento atualiza o evento existente no Google Agenda, sem criar um novo
- [ ] Falha no Google nao bloqueia a renovacao (RN-007)
- [ ] O sync roda so apos o commit da transacao; uma renovacao que falha nao sincroniza
- [ ] RN-007 atualizada em `docs/PRD.md` e na memoria do projeto
- [ ] `npm run test:unit`, `npm --prefix frontend run test:typecheck`, `npm run build:all` e `npm run test:e2e` verdes
- [ ] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Linear: DOC-42 (https://linear.app/docsob/issue/DOC-42). Mode: normal; executor Antigravity via Orca orchestration, judgment pass Claude.
- Decisao do dono (2026-10-23, sessao do orquestrador): Opcao A, sincronizar na renovacao.
- Regras: RN-007 em `.aihaus/memory/project/business-rules.md:76`; ADR-009 em `.aihaus/memory/project/decisions.md`.
- `backend/tests/document-transactions.test.ts:131-306` hoje afirma "no Google sync" na renovacao; os casos de falha continuam sem sync, o de sucesso passa a sincronizar.
- Worktree Orca `doc-42-renovacao-sync-agenda`, branch `anmarfp/doc-42-renovacao-sync-agenda`, base `0b218b0`.

## Owned files

- backend/src/controllers/documentController.ts (somente `renewDocument`), backend/tests/**
- docs/PRD.md (RN-007)
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**, .aihaus/memory/project/business-rules.md (orquestrador)

## Business-rule gaps

- none (Opcao A respondida pelo dono em 2026-10-23)

## Log

- 2026-10-23 criado pelo orquestrador a partir do Linear DOC-42.

## Evidence
