---
id: T-261023-429cbf-doc-39-paginacao-e-payload-enxuto-na-listagem-de
room: feature
external_id: "DOC-39"
created: 2026-10-23T14:11:05.554Z
---

# Goal

DOC-39: `GET /api/v1/documents` pagina no servidor e devolve so o necessario para a lista; a UI de documentos navega entre paginas sem regressao.

## Acceptance

- [ ] A listagem aceita `page`/`limit`, devolve no maximo `limit` itens (padrao 20, maximo 100) e informa `total`, `page` e `limit`
- [ ] A lista nao inclui o array `versions` nem a contagem de `auditLogs`; o detalhe do documento segue completo
- [ ] `EXPLAIN ANALYZE` da listagem padrao com 10k documentos e 200k linhas de auditoria abaixo de 200 ms, registrado em `docs/perf/`
- [ ] A pagina de documentos navega entre paginas sem regressao nos filtros (busca, categoria, status, arquivados para ADMIN); header e central de pendencias continuam mostrando todas as pendencias
- [ ] `npm run test:unit`, `npm --prefix frontend run test:typecheck`, `npm run build:all` e `npm run test:e2e` verdes
- [ ] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Linear: DOC-39 (https://linear.app/docsob/issue/DOC-39). Mode: normal; executor Antigravity via Orca orchestration, judgment pass Claude.
- Codigo atual: `backend/src/controllers/documentController.ts:365` (`listDocuments`, `findMany` sem `take`, `include.versions`, `_count.auditLogs`).
- Consumidores: `frontend/src/pages/documents/DocumentsPage.tsx:59`, `frontend/src/components/layout/Header.tsx:38` (badge = soma das listas), `frontend/src/pages/notifications/NotificationsPage.tsx:31`.
- Medicao de referencia: `docs/perf/doc-36-indices.md`.
- Worktree Orca `doc-39-paginacao-documentos`, branch `anmarfp/doc-39-paginacao-documentos`, base `0b218b0`.

## Owned files

- backend/src/controllers/documentController.ts (somente `listDocuments`), backend/tests/**
- frontend/src/features/documents/**, frontend/src/pages/documents/DocumentsPage.tsx, frontend/src/components/layout/Header.tsx, frontend/src/pages/notifications/NotificationsPage.tsx, frontend/tests/**
- docs/perf/doc-39-paginacao.md
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**

## Business-rule gaps

- none

## Log

- 2026-10-23 criado pelo orquestrador a partir do Linear DOC-39.

## Evidence
