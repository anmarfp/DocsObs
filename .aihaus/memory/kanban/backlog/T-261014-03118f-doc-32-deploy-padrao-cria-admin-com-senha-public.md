---
id: T-261014-03118f-doc-32-deploy-padrao-cria-admin-com-senha-public
room: bugfix
external_id: "DOC-32"
created: 2026-10-14T14:33:21.037Z
---

# Goal

DOC-32 deploy padrao cria admin com senha publicada

## Acceptance

- [ ] docker compose up com variaveis padrao nao cria nenhum usuario (RUN_SEED default false)
- [ ] Com NODE_ENV=production e RUN_SEED=true sem senhas definidas, o seed/boot falha com mensagem explicando o que configurar
- [ ] Usuarios e documentos demo nao sao criados em producao
- [ ] Botao de preenchimento rapido do login nao aparece no build de producao
- [ ] README nao publica senhas padrao e documenta como semear
- [ ] Testes backend e frontend verdes

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

## Evidence
