---
id: T-261014-70a390-doc-34-xss-armazenado-via-upload-de-anexo
room: bugfix
external_id: "DOC-34"
created: 2026-10-14T14:33:21.340Z
---

# Goal

DOC-34 XSS armazenado via upload de anexo

## Acceptance

- [ ] Upload de um .html renomeado como PDF (magic bytes nao conferem) e rejeitado no servidor
- [ ] Upload de um PDF legitimo com nome documento.exe e gravado com extensao .pdf
- [ ] A resposta de download/anexo traz Content-Disposition: attachment e X-Content-Type-Options: nosniff
- [ ] helmet aplicado na pilha global sem quebrar o proxy/SPA
- [ ] multer migrado para ^2
- [ ] Testes cobrindo os casos acima
- [ ] ARCHITECTURE.md descreve a validacao real

## Context

- Linear DOC-34 (P0-4). storageService.ts confia em file.mimetype e path.extname(originalname); app.ts serve /uploads via express.static.
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/src/services/storageService.ts, backend/src/app.ts, backend/package.json, backend/package-lock.json, backend/tests/**, frontend/src/features/documents/services/documentService.ts, docs/ARCHITECTURE.md

## Business-rule gaps

- Assumed decision: visualizacao no frontend continua (tipos verificados no servidor: pdf/png/jpg); download servido com attachment.

## Log

- 2026-10-14 ingerido do Linear DOC-34 pelo orquestrador.

## Evidence
