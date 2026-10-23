---
id: T-261023-02b140-doc-38-dependencias-vulneraveis-no-backend-e-fol
room: bugfix
external_id: "DOC-38"
created: 2026-10-23T14:07:13.870Z
---

# Goal

DOC-38 (parte 1): remover as vulnerabilidades conhecidas de runtime corrigiveis sem major (backend inteiro e `follow-redirects` no frontend). A migracao `react-router-dom@7` vai em PR separado.

## Acceptance

- [x] `npm audit --omit=dev` no backend sem achados
- [x] `npm audit --omit=dev --audit-level=high` no frontend sem achados high/critical
- [x] Lockfiles mudam so versoes de correcao dos pacotes afetados, sem bump major de dependencia direta
- [x] `npm run test:unit`, `npm --prefix frontend run test:typecheck`, `npm run build:all` e `npm run test:e2e` verdes
- [x] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Linear: DOC-38 (https://linear.app/docsob/issue/DOC-38). Mode: normal.
- Decisao do dono (2026-10-23, sessao do orquestrador): migrar para `react-router-dom@7`, em PR separado deste.
- `npm audit --omit=dev` em `0b218b0`: backend 7 (proxy-addr critico; deepmerge-ts/@prisma/config/prisma high; qs/body-parser/express moderado); frontend follow-redirects high + react-router moderado.
- Worktree Orca `doc-38-deps-backend`, branch `anmarfp/doc-38-deps-backend`, base `0b218b0`.

## Owned files

- backend/package.json, backend/package-lock.json
- frontend/package.json, frontend/package-lock.json
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**

## Business-rule gaps

- none

## Log

- 2026-10-23 criado pelo orquestrador a partir do Linear DOC-38.
- 2026-10-23 worktree recriado como `doc-38` (branch `anmarfp/doc-38`, a partir de b573c00); executor Antigravity em sessao supervisionada pelo Orca (terminal PowerShell).
- 2026-10-23 executor entregou e9ad675: express 4.22.2->4.22.3, body-parser 1.20.6->1.20.9, qs 6.15.3->6.16.1, proxy-addr 2.0.7->2.0.8, brace-expansion 2.1.4->2.1.7, follow-redirects 1.16.0->1.16.1; prisma e @prisma/client 6.19.3 -> ~6.12.0 (abaixo da faixa vulneravel 6.13-7.10 do deepmerge-ts, dentro do major 6 ja declarado ^6.4.1).
- 2026-10-23 judgment pass do orquestrador Claude: Dockerfile instalava `prisma@^6.4.1` (6.19.x vulneravel) na imagem. Retrabalho 1 (agy -p, contexto novo) -> eaffddb, mas a imagem passou a conter devDependencies (vitest, vite, typescript, supertest, tsx), confirmado com docker build. Retrabalho 2 (agy -p, contexto novo; o 1o lancamento foi encerrado por falta de memoria e relancado) -> 6a7514a: `npm ci --omit=dev --omit=optional` + `npm install -g prisma@<devDependencies.prisma>`.
- 2026-10-23 verificacao do orquestrador sobre 6a7514a + merge do main: imagem com --network none -> `npx prisma` usa /usr/local/bin/prisma 6.12.0 sem rede, 0 devDependencies, requires de runtime ok; backend audit --omit=dev 0; frontend audit high 0 (2 moderate react-router esperados); backend 300/300, frontend 45/45, typecheck 0, build 0, E2E 20/20.
- 2026-10-23 gotchas promovidos em `.aihaus/memory/project/knowledge.md` (pin do Prisma e CLI global na imagem). Proximo: DOC-38 parte 2 (react-router-dom@7) em PR separado, decisao do dono 2026-10-23.

## Evidence

Artifact: .aihaus/memory/evidence/T-261023-02b140-doc-38-dependencias-vulneraveis-no-backend-e-fol.json
