---
id: T-261023-2ea791-doc-40-filtro-de-data-da-auditoria-e-data-de-emi
room: bugfix
external_id: "DOC-40"
created: 2026-10-23T14:07:13.650Z
---

# Goal

DOC-40: o filtro de periodo da auditoria e a data de emissao padrao respeitam a data civil (servidor em `APP_TIMEZONE`, navegador no fuso local).

## Acceptance

- [x] Auditoria com `startDate=D1&endDate=D2` inclui eventos de D1 00:00 ate D2 23:59:59.999 em `APP_TIMEZONE` (gte meia-noite local de D1, lt meia-noite local de D2+1)
- [x] Teste de fronteira da meia-noite do filtro da auditoria passa com `TZ=America/Sao_Paulo` e `TZ=UTC`
- [x] Data de emissao padrao no cadastro e na renovacao e o dia local do usuario, com teste simulando 22:00 em UTC-3
- [x] `npm run test:unit`, `npm --prefix frontend run test:typecheck`, `npm run build:all` e `npm run test:e2e` verdes
- [x] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Linear: DOC-40 (https://linear.app/docsob/issue/DOC-40). Mode: normal (executor subagente + judgment pass em contexto separado).
- Regras: DOC-27 em `.aihaus/memory/project/business-rules.md:21` ("hoje" e data civil em `APP_TIMEZONE`); helpers em `backend/src/utils/date.ts`.
- `reportController.ts:44-48` filtra `expirationDate` (meia-noite UTC) e esta correto; fora do escopo.
- Worktree Orca `doc-40-auditoria-data-civil`, branch `anmarfp/doc-40-auditoria-data-civil`, base `0b218b0`.

## Owned files

- backend/src/controllers/auditController.ts, backend/src/utils/date.ts
- backend/tests/** (novo teste ou extensao de teste existente da auditoria)
- frontend/src/features/documents/components/DocumentFormModal.tsx, frontend/src/features/documents/components/DocumentRenewModal.tsx, o util que define `toInputDateFormat`
- frontend/tests/**
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**

## Business-rule gaps

- none

## Log

- 2026-10-23 criado pelo orquestrador a partir do Linear DOC-40.
- 2026-10-23 executor Antigravity (agy, terminal PowerShell via Orca) entregou 0e21e2f: unit 284+42, TZ=UTC e TZ=America/Sao_Paulo 284/284, typecheck 0, build 0, scope-check 0.
- 2026-10-23 judgment pass do orquestrador Claude (contexto separado) sobre 0e21e2f: ship. Reexecucao: unit 0, TZ x2 0, typecheck 0, build 0, scope-check outside=[], E2E 20/20.
- Risco residual (fora do escopo): `toInputDateFormat` segue em UTC para datas ISO vindas da API, o que e correto para datas civis gravadas em meia-noite UTC.

## Evidence

Artifact: .aihaus/memory/evidence/T-261023-2ea791-doc-40-filtro-de-data-da-auditoria-e-data-de-emi.json
