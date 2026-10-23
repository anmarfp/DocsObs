---
id: T-261023-02b140-doc-38-dependencias-vulneraveis-no-backend-e-fol
room: bugfix
external_id: "DOC-38"
created: 2026-10-23T14:07:13.870Z
---

# Goal

DOC-38 (parte 1): remover as vulnerabilidades conhecidas de runtime corrigiveis sem major (backend inteiro e `follow-redirects` no frontend). A migracao `react-router-dom@7` vai em PR separado.

## Acceptance

- [ ] `npm audit --omit=dev` no backend sem achados
- [ ] `npm audit --omit=dev --audit-level=high` no frontend sem achados high/critical
- [ ] Lockfiles mudam so versoes de correcao dos pacotes afetados, sem bump major de dependencia direta
- [ ] `npm run test:unit`, `npm --prefix frontend run test:typecheck`, `npm run build:all` e `npm run test:e2e` verdes
- [ ] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Linear: DOC-38 (https://linear.app/docsob/issue/DOC-38). Mode: normal.
- Decisao do dono (2026-10-23, sessao do orquestrador): migrar para `react-router-dom@7`, em PR separado deste.
- `npm audit --omit=dev` em `0b218b0`: backend 7 (proxy-addr critico; deepmerge-ts/@prisma/config/prisma high; qs/body-parser/express moderado); frontend follow-redirects high + react-router moderado.
- Worktree Orca `doc-38-deps-backend`, branch `anmarfp/doc-38-deps-backend`, base `0b218b0`.

## Owned files

- backend/package.json, backend/package-lock.json
- frontend/package.json, frontend/package-lock.json
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**

## Business-rule gaps

- none

## Log

- 2026-10-23 criado pelo orquestrador a partir do Linear DOC-38.

## Evidence
