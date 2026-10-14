---
id: T-261014-e0570a-doc-37-escritas-multi-etapa-sem-transacao-e-corr
room: bugfix
external_id: "DOC-37"
created: 2026-10-14T14:33:22.067Z
---

# Goal

DOC-37 escritas multi-etapa sem transacao e corrida no numero de versao

## Acceptance

- [ ] Renovacao, criacao, arquivamento e exclusao rodam em prisma.$transaction; efeitos externos (disco, Google) so apos commit
- [ ] Falha simulada em etapa intermediaria da renovacao nao deixa versao orfa nem documento parcialmente atualizado
- [ ] Duas renovacoes concorrentes nao produzem versionNumber duplicado (@@unique([documentId, versionNumber]) + conflito tratado)
- [ ] Falha no audit log na criacao nao deixa documento commitado apontando para arquivo apagado
- [ ] Testes cobrindo os tres cenarios
- [ ] ARCHITECTURE.md descreve o comportamento real

## Context

- Linear DOC-37 (P0-6). Regras: RN-002, RN-008. Depende de DOC-36 (migrations em sequencia).
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/src/controllers/documentController.ts, backend/src/services/documentService.ts (opcional), backend/prisma/schema.prisma, backend/prisma/migrations/<novo>, backend/tests/**, docs/ARCHITECTURE.md

## Business-rule gaps

- Assumed decision: a migration renumera version_number por documento (ordem version_number, created_at, id) antes de criar o unique, para nao derrubar o boot com dados duplicados.

## Log

- 2026-10-14 ingerido do Linear DOC-37 pelo orquestrador.

## Evidence
