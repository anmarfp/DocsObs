---
id: T-261014-e0570a-doc-37-escritas-multi-etapa-sem-transacao-e-corr
room: bugfix
external_id: "DOC-37"
created: 2026-10-14T14:33:22.067Z
---

# Goal

DOC-37 escritas multi-etapa sem transacao e corrida no numero de versao

## Acceptance

- [x] Renovacao, criacao, arquivamento e exclusao rodam em prisma.$transaction; efeitos externos (disco, Google) so apos commit
- [x] Falha simulada em etapa intermediaria da renovacao nao deixa versao orfa nem documento parcialmente atualizado
- [x] Duas renovacoes concorrentes nao produzem versionNumber duplicado (@@unique([documentId, versionNumber]) + conflito tratado)
- [x] Falha no audit log na criacao nao deixa documento commitado apontando para arquivo apagado
- [x] Testes cobrindo os tres cenarios
- [x] ARCHITECTURE.md descreve o comportamento real

## Context

- Linear DOC-37 (P0-6). Regras: RN-002, RN-008. Depende de DOC-36 (migrations em sequencia).
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/src/controllers/documentController.ts, backend/src/services/documentService.ts (opcional), backend/prisma/schema.prisma, backend/prisma/migrations/<novo>, backend/tests/**, docs/ARCHITECTURE.md

## Business-rule gaps

- Assumed decision: a migration renumera version_number por documento (ordem version_number, created_at, id) antes de criar o unique, para nao derrubar o boot com dados duplicados.

## Log

- 2026-10-14 ingerido do Linear DOC-37 pelo orquestrador.
- 2026-10-14 executor Antigravity (agy 1.3.5, gemini-3.8-flash-high) entregou 5ebe056 (base 4bdc042); orquestrador rebaseou para 741cc79.
- 2026-10-14 judgment pass 1 (orquestrador Claude): ship-with-changes. R1 regressao RN-007: deleteDocumentEvent movido para depois do hard delete; o cascade de gcal_sync_logs apaga o gcalEventId e o evento ficava orfao no Google. R2 perda de dados RN-002: renovacao apagava o anexo anterior referenciado pela versao arquivada. R3 escopo: renovacao passou a sincronizar com o Google (nao existia antes). R2 e R3 vieram da tabela de casos do brief do orquestrador (erro do orquestrador).
- 2026-10-14 retrabalho Antigravity em contexto novo: 8a5d48f (ordem do delete restaurada com comentario; renovacao preserva o anexo e nao sincroniza).
- 2026-10-14 judgment pass 2 (recheck R1-R3 + full): rebaseado para 69ff253 sobre 8ba35c6. Checkout limpo: npm run test:unit exit 0 (backend 245/245, frontend 34/34), backend build 0; migration em postgres:16-alpine descartavel com versoes (1,1,2) -> (1,2,3), indice unico criado e INSERT duplicado rejeitado; migrate diff --exit-code 0. npm run test:e2e (worktree Orca doc-37-e2e em 69ff253) exit 0, 19/19. Verdict: ship.
- Follow-up para o dono do produto: renovacao nao atualiza o evento no Google Agenda (comportamento pre-existente desde DOC-28).

## Evidence

Artifact: .aihaus/memory/evidence/T-261014-e0570a-doc-37-escritas-multi-etapa-sem-transacao-e-corr.json
