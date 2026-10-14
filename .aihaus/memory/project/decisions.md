# Decisions

Nota de numeração: `docs/ARCHITECTURE.md` §7 numera seus próprios ADRs de 001 a
005 (reviewed 5186755).

O antigo ledger do aihaus-okf (removido nesta migração; recuperável no histórico
Git no commit 824aace) usava ADR-001 a ADR-009 com significados diferentes.

Para evitar colisão: `ADR-A0x` = ADRs do ARCHITECTURE, `ADR-L0x` = ADRs do
ledger legado, `ADR-009` mantém o número citado pelos docs atuais.

## ADR-009 — Sincronização Google Agenda via OAuth por usuário

**Status:** accepted
**Date:** 2026-08-30
**Milestone:** DOC-28
**Amends:** ADR-L03

Related rules: RN-007

### Context

- Verified: a sincronização com o Google Agenda era simulada e foi substituída por integração real via Google Calendar API. Source: `docs/ARCHITECTURE.md` (reviewed 5186755).

### Decision

- Accepted: cada usuário (ADMIN ou OPERATIONAL) conecta a própria conta Google via OAuth2 em Configurações; tokens ficam em `google_oauth_tokens` (um por usuário), escopo `calendar.events`. Source: `docs/PRD.md` (reviewed 824aace).

### Consequences

- Verified: o evento é criado na agenda `primary` do usuário que cadastrou o documento (`createdById`); sem conexão, grava `gcal_sync_logs` com `ERROR`; o mesmo `gcalEventId` é reutilizado em update/delete para não duplicar eventos. Source: `backend/src/services/gcalService.ts` (reviewed 824aace).
- Verified: o callback `GET /calendar/google/callback` é público (registrado antes do `authMiddleware`) e a autenticidade vem do `state` assinado. Source: `backend/src/routes/calendarRoutes.ts` (reviewed 824aace).

### Reversal or migration

- Unresolved: não há plano documentado para migrar para conta de serviço/agenda corporativa.

## ADR-A01 — Monorepo modular local-first

**Status:** accepted
**Date:** unknown
**Milestone:** Fase 4
**Amends:** none

Related rules: none

### Decision

- Accepted: estrutura monorepo com `backend/` e `frontend/` independentes, scripts no `package.json` raiz e Docker Compose unificado (`docker compose up --build`). Source: `docs/ARCHITECTURE.md` (reviewed 5186755).

## ADR-A02 — Build multi-stage e Nginx como SPA + reverse proxy

**Status:** accepted
**Date:** unknown
**Milestone:** Fase 4
**Amends:** none

Related rules: none

### Decision

- Accepted: o frontend é compilado em multi-stage e servido por Nginx Alpine, que faz fallback SPA para `index.html` e proxy de `/api/v1/*` para o backend, eliminando CORS. Source: `docs/ARCHITECTURE.md` (reviewed 5186755).

## ADR-A03 — Abstração de storage (`IStorageService`)

**Status:** accepted
**Date:** unknown
**Milestone:** none
**Amends:** none

Related rules: none

### Decision

- Accepted: anexos ficam em disco local (volume `/app/uploads`) atrás de uma interface de storage, para migrar a S3/Supabase criando nova implementação. Source: `docs/ARCHITECTURE.md` (reviewed 5186755).

## ADR-A04 — Auditoria com diff estruturado em JSON

**Status:** accepted
**Date:** unknown
**Milestone:** none
**Amends:** none

Related rules: RN-008

### Decision

- Accepted: toda mutação grava em `audit_logs` autor, ação e payload JSONB com `old`/`new`. Source: `docs/ARCHITECTURE.md` (reviewed 5186755).

## ADR-A05 — Testes em três camadas

**Status:** accepted
**Date:** unknown
**Milestone:** Fase 4
**Amends:** none

Related rules: none

### Decision

- Accepted: Vitest no backend (unitário/integração), Vitest + React Testing Library no frontend, e E2E HTTP com Vitest contra containers reais via `scripts/run-e2e.mjs`. Source: `docs/ARCHITECTURE.md` (reviewed 5186755).

## ADR-L04 — Modo global de notificação por empresa

**Status:** accepted
**Date:** 2026-07-31
**Milestone:** none
**Amends:** none

Related rules: RN-004

### Decision

- Accepted: uma chave global por empresa escolhe `ALL_ADMINS` ou `ONLY_RESPONSIBLE`, controlando destinatários e a visibilidade do campo Responsável. Source: `docs/PRD.md` (reviewed 824aace).

## Legacy ledger entries pending review

- Unresolved: os ADRs legados L01 (e-mail como canal exclusivo no MVP), L02 (sem restrição por setor no MVP), L03 (integração Google Agenda, emendado por ADR-009), L05 (aba de auditoria), L06 (arquitetura REST/SPA desacoplada), L07 (PostgreSQL + storage local-first), L08 (pipeline multiagente via Orca CLI) e a padronização da paleta do protótipo existiam só no ledger antigo. L05–L07 estão cobertos por ADR-A01/A03/A04; os demais precisam de confirmação do dono antes de voltar a ser "accepted". Recuperar com `git show 824aace` no ledger antigo.
