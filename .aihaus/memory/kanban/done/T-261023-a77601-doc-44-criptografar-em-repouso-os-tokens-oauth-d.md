---
id: T-261023-a77601-doc-44-criptografar-em-repouso-os-tokens-oauth-d
room: feature
external_id: "DOC-44"
created: 2026-10-23T20:18:16.492Z
---

# Goal

DOC-44: os tokens OAuth do Google Agenda (`access_token` e `refresh_token`) ficam cifrados em repouso com AES-256-GCM, sem regressão na conexão, sincronização e revogação.

## Acceptance

- [x] Nenhum `access_token`/`refresh_token` é gravado em texto puro no callback OAuth nem na renovação automática do token
- [x] Sync, revogação e status funcionam com tokens cifrados e com tokens legados em texto puro
- [x] Linhas legadas são cifradas no boot de forma idempotente
- [x] Produção com integração Google configurada e sem `GOOGLE_TOKEN_ENCRYPTION_KEY` válida aborta o boot
- [x] `.env.example`, `backend/.env.example`, `docker-compose.yml` e README documentam a chave e como gerá-la
- [x] `npm run test:unit`, `npm --prefix frontend run test:typecheck`, `npm run build:all` e `npm run test:e2e` verdes
- [x] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Linear: DOC-44 (https://linear.app/docsob/issue/DOC-44). Pedido do dono em 2026-10-23 ("Criptografe, por favor").
- Regras/decisões: ADR-009 e RN-007 (`.aihaus/memory/project/decisions.md`, `business-rules.md`); env só em `backend/src/config/env.ts` (`knowledge.md`, DOC-33).
- Pontos de gravação: `backend/src/controllers/googleAuthController.ts:130-141` (upsert no callback) e `backend/src/services/gcalService.ts:67-84` (evento `tokens`). Pontos de leitura: `googleAuthController.ts:117`, `:165`, `:188-196` (revogação) e `gcalService.ts:207`, `:318` (sync).
- Sem mudança de schema: as colunas continuam `TEXT`.
- Mode: normal; executor Antigravity via `agy -p`, judgment pass Claude.
- Worktree Orca `doc-44`, branch `anmarfp/doc-44`, base `ce9a0f8`.

## Owned files

- backend/src/config/env.ts, backend/src/utils/** (módulo de cripto), backend/src/services/gcalService.ts, backend/src/services/** (módulo de acesso aos tokens), backend/src/controllers/googleAuthController.ts, backend/src/server.ts
- backend/tests/**
- .env.example, backend/.env.example, docker-compose.yml, README.md
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**, .aihaus/memory/project/** (orquestrador)

## Business-rule gaps

- none

## Log

- 2026-10-23 criado pelo orquestrador a partir do Linear DOC-44.
- 2026-10-23 executor Antigravity (`agy -p` no shell do orquestrador) entregou 597c468: tokenCrypto.ts (AES-256-GCM, enc:v1), googleTokenStore.ts como ponto unico de acesso, env GOOGLE_TOKEN_ENCRYPTION_KEY, backfill no boot, docs (.env.example, backend/.env.example, docker-compose.yml, README). Relatorio: backend 312, frontend 46, typecheck/build/compose config 0, grep confinado ao store.
- 2026-10-23 judgment pass do orquestrador Claude (contexto separado) sobre 597c468: ship. Achados LOW nao bloqueantes: (1) o backfill recifraria um valor `enc:` corrompido de outro prefixo como texto puro e tem janela minima de corrida com um callback OAuth simultaneo no boot; (2) ramos defensivos para mocks (`typeof`, `row.id ?`) no store.
- 2026-10-23 verificacao do orquestrador: backfill contra PostgreSQL 16 real com 2 linhas legadas -> run1 migrou 2, run2 migrou 0, decrypt devolve o valor original, nenhuma coluna em texto puro; apos merge do main: backend 312/312 (TZ local e UTC), frontend 46/46, typecheck 0, build 0, docker compose config 0, E2E 20/20.
- 2026-10-23 fatos promovidos em knowledge.md, environment.md e deployment.md (cifra dos tokens, nova variavel, estabilidade da chave entre deploys). Risco residual: rotacao de chave sem keyring desconecta os usuarios.

## Evidence

Artifact: .aihaus/memory/evidence/T-261023-a77601-doc-44-criptografar-em-repouso-os-tokens-oauth-d.json
