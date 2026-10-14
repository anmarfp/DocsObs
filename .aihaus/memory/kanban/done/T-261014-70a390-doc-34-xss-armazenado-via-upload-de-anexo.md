---
id: T-261014-70a390-doc-34-xss-armazenado-via-upload-de-anexo
room: bugfix
external_id: "DOC-34"
created: 2026-10-14T14:33:21.340Z
---

# Goal

DOC-34 XSS armazenado via upload de anexo

## Acceptance

- [x] Upload de um .html renomeado como PDF (magic bytes nao conferem) e rejeitado no servidor
- [x] Upload de um PDF legitimo com nome documento.exe e gravado com extensao .pdf
- [x] A resposta de download/anexo traz Content-Disposition: attachment e X-Content-Type-Options: nosniff
- [x] helmet aplicado na pilha global sem quebrar o proxy/SPA
- [x] multer migrado para ^2
- [x] Testes cobrindo os casos acima
- [x] ARCHITECTURE.md descreve a validacao real

## Context

- Linear DOC-34 (P0-4). storageService.ts confia em file.mimetype e path.extname(originalname); app.ts serve /uploads via express.static.
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/src/services/storageService.ts, backend/src/app.ts, backend/package.json, backend/package-lock.json, backend/tests/**, frontend/src/features/documents/services/documentService.ts, docs/ARCHITECTURE.md

## Business-rule gaps

- Assumed decision: visualizacao no frontend continua (tipos verificados no servidor: pdf/png/jpg); download servido com attachment.

## Log

- 2026-10-14 ingerido do Linear DOC-34 pelo orquestrador.
- 2026-10-14 executor (subagente Claude) entregou a75d773 (base 38bed91), rebaseado pelo orquestrador para f37cf6b sobre origin/main; scope-check ok.
- 2026-10-14 judgment pass (orquestrador, contexto separado; lente security): full review de f37cf6b. Checkout limpo: backend vitest 217/217 exit 0, build 0; frontend vitest 32/32 exit 0, typecheck 0; npm audit --omit=dev identico ao main (advisories do multer 1.x removidos). Rotas com upload: documentRoutes.ts:22,31,37 (todas via upload.single). Verdict: ship.
- Riscos aceitos/follow-ups: poliglota com prefixo %PDF- e aceito mas servido como application/pdf+nosniff+attachment; upload em memoria (ate 10 MB por request); HSTS default do helmet; npm audit pre-existente (proxy-addr critical, prisma/express) sem tarefa; nginx.conf sem headers de seguranca no SPA.

## Evidence

Artifact: .aihaus/memory/evidence/T-261014-70a390-doc-34-xss-armazenado-via-upload-de-anexo.json
