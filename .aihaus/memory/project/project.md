# Project

## Purpose

- Verified: DocsObs é uma plataforma web para controle, acompanhamento e renovação de documentos corporativos com vencimento (certidões, licenças, contratos, apólices, obrigações trabalhistas), com matriz visual de cores, alertas de prazo, sincronização com calendário e trilha de auditoria. Source: `docs/PRD.md` (reviewed 824aace).
- Verified: o problema endereçado é a perda de prazos causada pelo acompanhamento manual em planilhas/e-mail (multas, suspensão de alvarás, bloqueios contratuais, impedimento em licitações). Source: `docs/PRD.md` (reviewed 824aace).

## Users and outcomes

- Verified: existem dois papéis, `ADMIN` (Administrador/Gestor) e `OPERATIONAL` (Operacional/Analista); o ADMIN tem acesso irrestrito e o OPERATIONAL faz as operações do dia a dia sem acesso a arquivados, hard delete, auditoria, gestão de usuários e configurações globais. Source: `docs/PRD.md` (reviewed 824aace).
- Accepted: metas declaradas — zero vencimentos não detectados, busca em menos de 1 segundo, diff de auditoria em 100% das mutações, dashboard com recorte dos próximos 30 dias. Source: `docs/PRD.md` (reviewed 824aace).

## In scope

- Verified: entregáveis do MVP — autenticação/RBAC/gestão de usuários, CRUD de documentos com anexo até 10 MB, renovação com versionamento (`document_versions`), dashboard por matriz de cores, configuração de modo de notificação, calendário com sincronização Google Agenda, trilha de auditoria com diff, exportação CSV/JSON, Docker Compose unificado e suíte de testes. Source: `docs/PRD.md` (reviewed 824aace).
- Verified: o repositório é um monorepo com `backend/` (Express + Prisma) e `frontend/` (React + Vite) orquestrados pelo `package.json` raiz e pelo `docker-compose.yml`. Source: `package.json` (reviewed 824aace).

## Out of scope

- Accepted: pós-MVP (fora do escopo atual) — multi-tenancy, notificações por WhatsApp/SMS, OCR/IA para extração de datas, integração direta com órgãos públicos para CNDs. Source: `docs/PRD.md` (reviewed 824aace).
- Accepted: o MVP é single-tenant (uma única empresa/organização) — RN-005. Source: `docs/PRD.md` (reviewed 824aace).

## Definition of Done

- Inferred candidate: a suíte completa roda com `npm run test:all` (unitários backend + frontend, depois E2E via `scripts/run-e2e.mjs`); os docs citam 187/187 testes passando, mas essa contagem não foi reexecutada nesta revisão. Source: `package.json` (reviewed 824aace).
- Unresolved: não há definição explícita de Definition of Done aprovada pelo dono do projeto, e não existe pipeline de CI no repositório (sem diretório `.github/`). Source: `README.md` (reviewed 824aace).

## Current constraints

- Verified: PRD (v1.0.0) e ARCHITECTURE (v1.1.0) declaram as Fases 1 a 4 concluídas e o sistema "Em Produção". Source: `docs/ARCHITECTURE.md` (reviewed 5186755).
- Unresolved: os docs afirmam recálculo diário automático, envio de e-mails e validação de magic bytes, mas o código não confirma esses três pontos — ver `knowledge.md` (Conflitos entre docs e código). Source: `backend/src/services/cronService.ts` (reviewed 824aace).
