---
id: T-261014-03118f-doc-32-deploy-padrao-cria-admin-com-senha-public
room: bugfix
external_id: "DOC-32"
created: 2026-10-14T14:33:21.037Z
---

# Goal

DOC-32 deploy padrao cria admin com senha publicada

## Acceptance

- [x] docker compose up com variaveis padrao nao cria nenhum usuario (RUN_SEED default false)
- [x] Com NODE_ENV=production e RUN_SEED=true sem senhas definidas, o seed/boot falha com mensagem explicando o que configurar
- [x] Usuarios e documentos demo nao sao criados em producao
- [x] Botao de preenchimento rapido do login nao aparece no build de producao
- [x] README nao publica senhas padrao e documenta como semear
- [x] Testes backend e frontend verdes

## Context

- Linear DOC-32 (P0-2). Regras: RN-009. Tarefa legada T-260901-n0hk8w (aihaus-okf, nunca entregue).
- Cadeia: docker-compose.yml RUN_SEED default true -> senhas vazias -> seed.ts fallback '||' -> entrypoint executa seed.
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

docker-compose.yml, backend/docker-entrypoint.sh, backend/prisma/seed.ts, README.md, frontend/src/pages/auth/LoginPage.tsx, testes relacionados, .env.example (raiz/backend) se citarem senhas

## Business-rule gaps

- Assumed decision: em dev, sem senha definida, o seed gera senha aleatoria por usuario e imprime uma vez no console.

## Log

- 2026-10-14 ingerido do Linear DOC-32 pelo orquestrador.
- 2026-10-14 executor (subagente Claude) entregou 64605d0 (base 38bed91); orquestrador rebaseou para 56324bb sobre 4bdc042. Review encontrou 2 lacunas fora do escopo do executor (runner E2E sem senhas do seed; docs/PRD.md publicando senhas).
- 2026-10-14 retrabalho por executor Antigravity (agy 1.3.5, gemini-3.8-flash-high): 86bc600, escopo scripts/run-e2e.mjs, docs/PRD.md, README.md.
- 2026-10-14 judgment pass (orquestrador Claude, outra familia de modelo do autor do retrabalho): full review de 56324bb+86bc600 vs 4bdc042. Checkout limpo 86bc600: npm run test:unit exit 0 (backend 225/225, frontend 34/34), frontend typecheck 0, build 0 e dist sem senhas antigas, backend build 0. npm run test:e2e (sem senhas exportadas): seed em producao concluido com senhas geradas, 18/19; unica falha 05-calendar-events.test.ts:44 (synced>=1) e pre-existente desde DOC-28 (sync real exige OAuth do usuario; stack E2E sem token) - wave 1 nao toca gcalService nem sync. Verdict: ship.
- Follow-up: corrigir TC-E2E-05 para o comportamento OAuth real (sem conexao => ERROR log, synced 0).

## Evidence

Artifact: .aihaus/memory/evidence/T-261014-03118f-doc-32-deploy-padrao-cria-admin-com-senha-public.json
