---
id: T-261014-6b2420-doc-33-jwt-assinado-com-segredo-padrao-versionad
room: bugfix
external_id: "DOC-33"
created: 2026-10-14T14:33:21.818Z
---

# Goal

DOC-33 JWT assinado com segredo padrao versionado

## Acceptance

- [ ] Backend com NODE_ENV=production sem JWT_SECRET (ou <32 chars) aborta no boot com mensagem nomeando a variavel
- [ ] Nenhuma string literal de segredo em backend/src nem docker-compose.yml
- [ ] Variaveis de ambiente lidas de um unico modulo tipado backend/src/config/env.ts (Zod)
- [ ] Teste cobrindo o boot que falha
- [ ] Suites verdes

## Context

- Linear DOC-33 (P0-3). jwt.ts fallback e docker-compose JWT_SECRET default.
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/src/config/env.ts (novo), backend/src/server.ts, backend/src/utils/jwt.ts, leitores de process.env em backend/src/**, docker-compose.yml, .env.example, README.md (secao env), backend/tests/**

## Business-rule gaps

- Assumed decision: fora de producao, sem JWT_SECRET, gera segredo aleatorio por processo com aviso.

## Log

- 2026-10-14 ingerido do Linear DOC-33 pelo orquestrador.

## Evidence
