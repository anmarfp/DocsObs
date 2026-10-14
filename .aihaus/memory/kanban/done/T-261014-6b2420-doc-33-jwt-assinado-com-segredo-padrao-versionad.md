---
id: T-261014-6b2420-doc-33-jwt-assinado-com-segredo-padrao-versionad
room: bugfix
external_id: "DOC-33"
created: 2026-10-14T14:33:21.818Z
---

# Goal

DOC-33 JWT assinado com segredo padrao versionado

## Acceptance

- [x] Backend com NODE_ENV=production sem JWT_SECRET (ou <32 chars) aborta no boot com mensagem nomeando a variavel
- [x] Nenhuma string literal de segredo em backend/src nem docker-compose.yml
- [x] Variaveis de ambiente lidas de um unico modulo tipado backend/src/config/env.ts (Zod)
- [x] Teste cobrindo o boot que falha
- [x] Suites verdes

## Context

- Linear DOC-33 (P0-3). jwt.ts fallback e docker-compose JWT_SECRET default.
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/src/config/env.ts (novo), backend/src/server.ts, backend/src/utils/jwt.ts, leitores de process.env em backend/src/**, docker-compose.yml, .env.example, README.md (secao env), backend/tests/**

## Business-rule gaps

- Assumed decision: fora de producao, sem JWT_SECRET, gera segredo aleatorio por processo com aviso.

## Log

- 2026-10-14 ingerido do Linear DOC-33 pelo orquestrador.
- 2026-10-14 executor Antigravity (agy 1.3.5, gemini-3.8-flash-high) entregou 17d834e (base 4bdc042); orquestrador rebaseou (3d7f915) resolvendo conflito no README com DOC-32.
- 2026-10-14 judgment pass 1 (orquestrador Claude): ship-with-changes. F1: env.ts exportava getters relendo process.env cru, contornando o schema Zod. F2: boot invalido morria com stack trace.
- 2026-10-14 retrabalho Antigravity em contexto novo: cb4b9ee (env = loadEnv() congelado via IIFE com console.error+exit(1); testes usam vi.mock do modulo env).
- 2026-10-14 judgment pass 2 (recheck F1/F2 + full): rebaseado para edfc781 sobre b30f64b. Checkout limpo: npm run test:unit exit 0 (backend 235/235, frontend 34/34), backend build 0; node dist/src/server.js sem JWT_SECRET -> exit 1, stderr so com a mensagem; JWT_SECRET curto -> exit 1; docker compose config sem JWT_SECRET -> exit 1 com mensagem; npm run test:e2e exit 0 (19/19) sem variaveis exportadas; git grep process.env backend/src -> so config/env.ts. Verdict: ship.
- Nota operacional: docker compose (inclusive down/logs) passa a exigir JWT_SECRET no .env.

## Evidence

Artifact: .aihaus/memory/evidence/T-261014-6b2420-doc-33-jwt-assinado-com-segredo-padrao-versionad.json
