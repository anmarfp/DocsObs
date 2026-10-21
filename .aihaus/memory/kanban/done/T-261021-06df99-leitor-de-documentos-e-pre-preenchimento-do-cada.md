---
id: T-261021-06df99-leitor-de-documentos-e-pre-preenchimento-do-cada
room: feature
created: 2026-10-21T19:10:00.000Z
---

# Goal

Leitor de documentos e pre-preenchimento do cadastro

## Acceptance

- [x] Servico Python `extraction-service/` (OCR Tesseract + regras) le PDF, PNG e JPEG e devolve data de emissao, data de vencimento e orgao emissor com confianca, via HTTP (`GET /health`, `POST /extract`)
- [x] Servico sobe pelo perfil opcional `extraction` do `docker-compose.yml`; sem o perfil o stack sobe como antes
- [x] `POST /api/v1/documents/extract` no backend repassa o anexo ao servico e devolve os tres campos com confianca; sem servico configurado responde sem quebrar o cadastro manual
- [x] Formulario de cadastro pre-preenche com destaque visual e exige confirmacao humana antes de salvar
- [x] Auditoria distingue campo sugerido automaticamente de campo digitado (`fieldOrigins`)
- [x] Testes Python, backend, frontend, typecheck, build e E2E verdes

## Context

- Mode: normal com executor Antigravity (`agy`, gemini-4-argon-high) em worktree Orca + judgment pass do orquestrador Claude (contexto separado do autor).
- Motor unico: Tesseract (`por`). A interface de motor (`extraction/interface.py`) permite outro motor no futuro.
- Autorizacao: pedido do usuario em 2026-10-21 para abrir o PR e fazer o merge no `main`.

## Owned files

- extraction-service/**
- backend/src/config/env.ts, backend/src/controllers/documentController.ts, backend/src/routes/documentRoutes.ts, backend/src/services/extractionService.ts, backend/src/services/storageService.ts
- backend/tests/document-extraction.test.ts, backend/tests/e2e/09-document-extraction.test.ts
- frontend/src/features/audit/components/AuditDiffViewer.tsx, frontend/src/features/documents/components/DocumentFormModal.tsx, frontend/src/features/documents/services/documentService.ts, frontend/src/features/documents/utils/formDataHelper.ts, frontend/tests/document-extraction.test.tsx
- docker-compose.yml, .env.example, .gitignore, README.md
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**

## Business-rule gaps

- none

## Log

- 2026-10-21 criado pelo orquestrador; worktree Orca `extracao-ocr`, branch `anmarfp/extracao-ocr`, base `b4d4d64`.
- 2026-10-21 executor Antigravity gemini-4-argon-high (base d260787): commits ac550ad (servico `extraction-service/`) e cd6e84a (integracao backend/frontend/compose). Relatorio do executor: backend 277, frontend 41, pytest 61, typecheck/build 0.
- 2026-10-21 judgment pass (orquestrador Claude, contexto separado do autor) sobre cd6e84a: diff revisado (servico, registro local de motor em `server.py`, vocabulario reduzido ao que o leitor usa, integracao backend/frontend/compose). Reexecucao: backend 277/277, frontend 41/41, typecheck 0, build 0, scope-check ok, `docker build` 0 (imagem 551 MB), pytest 61/61, E2E 20/20 (2a tentativa, em terminal Orca; a 1a foi interrompida pelo Claude Code por falta de memoria no host). Fumaca com `--profile extraction`: extracao 200 com os tres campos, 401 sem token, 400 sem confirmacao, 201 confirmado com `fieldOrigins` AUTO/AUTO/MANUAL. Verdict: ship.
- Follow-up (fora do escopo): `NUMERIC_DATE_RE` em `extraction-service/extraction/dates.py` rejeita data seguida de ponto final de frase ("emitida em 15/03/2026.") por causa do lookahead `(?![\w\/\.\-])`; a data volta `null` e o usuario digita manualmente.

## Evidence

Artifact: .aihaus/memory/evidence/T-261021-06df99-leitor-de-documentos-e-pre-preenchimento-do-cada.json
