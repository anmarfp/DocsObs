---
id: T-261023-1b7e42-doc-38-parte-2-migrar-react-router-dom-para-v7
room: feature
created: 2026-10-23T18:07:06.256Z
---

# Goal

DOC-38 (parte 2): migrar o frontend de `react-router-dom@6` para a v7 corrigida, eliminando os 2 achados moderados (open redirect via barra invertida em <Link>/useNavigate) sem regressão de navegação.

## Acceptance

- [ ] `npm --prefix frontend audit --omit=dev` sem achados
- [ ] Rotas, redirecionamentos (ProtectedRoute, Navigate), links, query string e parâmetros funcionam como antes, cobertos pelos testes existentes
- [ ] `npm run test:unit`, `npm --prefix frontend run test:typecheck`, `npm run build:all` e `npm run test:e2e` verdes
- [ ] Judgment pass em contexto separado sem achado CRITICAL/HIGH aberto

## Context

- Linear: DOC-38 (https://linear.app/docsob/issue/DOC-38), parte 2. Parte 1 mergeada no PR #28 (8c501d5).
- Decisão do dono (2026-10-23, sessão do orquestrador): migrar para `react-router-dom@7` em PR separado.
- Uso atual: modo declarativo de SPA (`BrowserRouter` em `frontend/src/App.tsx`, Routes/Route/Navigate/Outlet/Link/NavLink, useNavigate/useLocation/useParams/useSearchParams; MemoryRouter nos testes), 21 arquivos.
- Mode: normal; executor Antigravity via `agy -p`, judgment pass Claude.
- Worktree Orca `doc-38-router`, branch `anmarfp/doc-38-router`, base `8c501d5`.

## Owned files

- frontend/package.json, frontend/package-lock.json, frontend/src/**, frontend/tests/**
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**

## Business-rule gaps

- none

## Log

- 2026-10-23 criado pelo orquestrador (DOC-38 parte 2).

## Evidence
