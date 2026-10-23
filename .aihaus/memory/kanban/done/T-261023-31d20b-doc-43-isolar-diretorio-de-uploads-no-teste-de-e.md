---
id: T-261023-31d20b-doc-43-isolar-diretorio-de-uploads-no-teste-de-e
room: bugfix
external_id: "DOC-43"
created: 2026-10-23T18:36:10.697Z
---

# Goal

DOC-43: `backend/tests/document-extraction.test.ts` deixa de depender do diretório de uploads compartilhado por outros arquivos de teste que rodam em paralelo, e a suíte backend fica determinística.

## Acceptance

- [x] `document-extraction.test.ts` usa um `UPLOAD_DIR` temporário próprio e não lê o diretório de uploads compartilhado
- [x] `npm --prefix backend test` passa 10 vezes seguidas sem falha
- [x] `npm run test:unit` e `npm --prefix frontend run test:typecheck` verdes
- [x] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Linear: DOC-43 (https://linear.app/docsob/issue/DOC-43). Falhas observadas em 23/10/2026: `expected 2 to be 1` e `expected +0 to be 1` em `document-extraction.test.ts:213`, em 3 verificações (PRs #25, #26, #29), todas aprovadas na reexecução.
- Causa: `UPLOADS_DIR` vem de `backend/src/services/storageService.ts:9` (`env.UPLOAD_DIR`, padrão `./uploads`); outros arquivos (`document.test.ts`, `document-transactions.test.ts`, `renew-audit.test.ts`) gravam nele em paralelo.
- Padrão existente: `backend/tests/upload-security.test.ts:8-16` (`vi.hoisted` + `process.env.UPLOAD_DIR` num diretório temporário).
- Sem CI no repositório; mudança só de teste, sem regressão de produto (waiver do teste de regressão vermelho: a falha é intermitente; a prova é a repetição).
- Mode: normal; executor Antigravity via `agy -p`, judgment pass Claude.
- Worktree Orca `doc-43`, branch `anmarfp/doc-43`, base `f02c071`.

## Owned files

- backend/tests/document-extraction.test.ts
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**

## Business-rule gaps

- none

## Log

- 2026-10-23 criado pelo orquestrador a partir do Linear DOC-43.
- 2026-10-23 executor Antigravity (`agy -p` no shell do orquestrador) entregou 42a3d1d: UPLOAD_DIR temporario por suite via vi.hoisted + UPLOAD_DIR no env mockado, afterAll remove o diretorio, assercoes de isolamento (UPLOADS_DIR = dir temporario, contagem 0 antes e depois). Relatorio: 10 execucoes 300/300.
- 2026-10-23 judgment pass do orquestrador Claude (contexto separado) sobre 42a3d1d: ship. Reexecucao: `npm --prefix backend test` 10x seguidas, todas 300/300; frontend 46/46; typecheck 0; escopo = so o arquivo de teste. E2E nao exigido (mudanca apenas de teste).
- 2026-10-23 gotcha promovido em `.aihaus/memory/project/knowledge.md` (testes que inspecionam uploads precisam de UPLOAD_DIR proprio).

## Evidence

Artifact: .aihaus/memory/evidence/T-261023-31d20b-doc-43-isolar-diretorio-de-uploads-no-teste-de-e.json
