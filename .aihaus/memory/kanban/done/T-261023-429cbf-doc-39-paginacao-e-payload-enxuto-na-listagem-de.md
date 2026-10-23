---
id: T-261023-429cbf-doc-39-paginacao-e-payload-enxuto-na-listagem-de
room: feature
external_id: "DOC-39"
created: 2026-10-23T14:11:05.554Z
---

# Goal

DOC-39: `GET /api/v1/documents` pagina no servidor e devolve so o necessario para a lista; a UI de documentos navega entre paginas sem regressao.

## Acceptance

- [x] A listagem aceita `page`/`limit`, devolve no maximo `limit` itens (padrao 20, maximo 100) e informa `total`, `page` e `limit`
- [x] A lista nao inclui o array `versions` nem a contagem de `auditLogs`; o detalhe do documento segue completo
- [x] `EXPLAIN ANALYZE` da listagem padrao com 10k documentos e 200k linhas de auditoria abaixo de 200 ms, registrado em `docs/perf/`
- [x] A pagina de documentos navega entre paginas sem regressao nos filtros (busca, categoria, status, arquivados para ADMIN); header e central de pendencias continuam mostrando todas as pendencias
- [x] `npm run test:unit`, `npm --prefix frontend run test:typecheck`, `npm run build:all` e `npm run test:e2e` verdes
- [x] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

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
- 2026-10-23 worktree recriado como `doc-39` (branch `anmarfp/doc-39`, a partir de 775c471); executor Antigravity via `agy -p` no shell do orquestrador (sem variaveis ORCA_*), depois que o Orca nao entregou o prompt.
- 2026-10-23 executor Antigravity entregou e9de1ad: unit 285+44, typecheck 0, build 0, scope-check 0, EXPLAIN ANALYZE 408,66 ms -> 0,084 ms (docs/perf/doc-39-paginacao.md).
- 2026-10-23 judgment pass do orquestrador Claude (contexto separado) sobre e9de1ad: ship. Reexecucao: backend TZ=UTC 285/285, TZ=America/Sao_Paulo 285/285, frontend 44/44, typecheck 0, build 0, scope-check outside=[], E2E 20/20; medicao reproduzida em Postgres descartavel (10k/30k/200k): findMany 0,080-0,096 ms, count 2,5 ms.
- 2026-10-23 a 1a execucao de `npm run test:unit` falhou em `document-extraction.test.ts` (teste instavel preexistente do PR #23: conta arquivos de uploads/ com outros arquivos de teste gravando em paralelo); passou nas reexecucoes. Follow-up no Linear.
- Risco residual LOW: apos excluir o ultimo item da ultima pagina a barra pode mostrar pagina > total ate o usuario voltar uma pagina.

## Evidence

Artifact: .aihaus/memory/evidence/T-261023-429cbf-doc-39-paginacao-e-payload-enxuto-na-listagem-de.json
