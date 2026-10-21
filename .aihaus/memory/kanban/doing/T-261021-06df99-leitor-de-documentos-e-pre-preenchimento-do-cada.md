---
id: T-261021-06df99-leitor-de-documentos-e-pre-preenchimento-do-cada
room: feature
created: 2026-10-21T19:10:00.000Z
---

# Goal

Leitor de documentos e pre-preenchimento do cadastro

## Acceptance

- [ ] Servico Python `extraction-service/` (OCR Tesseract + regras) le PDF, PNG e JPEG e devolve data de emissao, data de vencimento e orgao emissor com confianca, via HTTP (`GET /health`, `POST /extract`)
- [ ] Servico sobe pelo perfil opcional `extraction` do `docker-compose.yml`; sem o perfil o stack sobe como antes
- [ ] `POST /api/v1/documents/extract` no backend repassa o anexo ao servico e devolve os tres campos com confianca; sem servico configurado responde sem quebrar o cadastro manual
- [ ] Formulario de cadastro pre-preenche com destaque visual e exige confirmacao humana antes de salvar
- [ ] Auditoria distingue campo sugerido automaticamente de campo digitado (`fieldOrigins`)
- [ ] Testes Python, backend, frontend, typecheck, build e E2E verdes

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

## Evidence
