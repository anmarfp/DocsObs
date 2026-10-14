---
id: T-261014-518675-doc-27-status-expired-em-vez-de-critical-por-fus
room: bugfix
external_id: "DOC-27"
created: 2026-10-14T14:33:20.668Z
---

# Goal

DOC-27 status EXPIRED em vez de CRITICAL por fuso em normalizeDateToMidnight

## Acceptance

- [x] normalizeDateToMidnight trata datas como civis em UTC (getUTC*/Date.UTC) e "hoje" e a data civil no fuso de negocio
- [x] Documento que vence hoje (data civil) e CRITICAL, nao EXPIRED, com o processo em UTC-3 e em UTC
- [x] Limites de mes do calendario e janela de proximos vencimentos do dashboard usam a mesma convencao UTC civil
- [x] notification-gcal.test.ts congela o relogio com vi.setSystemTime e a suite backend fica verde
- [x] Teste de regressao na fronteira da meia-noite UTC falha no codigo antigo e passa no novo

## Context

- Linear DOC-27 (comentario de 01/09 com mapa de impacto). Regras: RN-001.
- Datas sao gravadas como meia-noite UTC (documentController.ts) e lidas com getters locais em statusService.ts.
- Baseline 1fa9fa1: backend 184/185, unica falha notification-gcal.test.ts (este bug).
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/src/services/statusService.ts, backend/src/controllers/calendarController.ts, backend/src/services/dashboardService.ts, backend/tests/** (novos/ajustados)

## Business-rule gaps

- Assumed decision: expirationDate e data civil (meia-noite UTC); "hoje" = data civil no fuso de negocio APP_TIMEZONE (default America/Sao_Paulo).

## Log

- 2026-10-14 ingerido do Linear DOC-27 pelo orquestrador.
- 2026-10-14 executor (subagente Claude, worktree isolada) entregou b5a6708 (base 38bed91); scope-check ok.
- 2026-10-14 judgment pass (orquestrador, contexto separado do autor; modelo do executor nao exposto): full review de b5a6708 vs 38bed91. Comandos em checkout limpo (git worktree --detach b5a6708): vitest run TZ=America/Sao_Paulo/UTC/Asia/Tokyo exit 0 (200/200 cada), npm run build exit 0. Verdict: ship. Recipient: orquestrador (merge).
- Gaps fora de escopo registrados: notificationService.ts:96 toLocaleDateString sem timeZone (data do e-mail um dia antes) -> absorvido em DOC-31; reportController.ts:46-47/auditController.ts:57-58 endDate em meia-noite UTC; default de data de emissao no frontend usa data UTC.

## Evidence

Artifact: .aihaus/memory/evidence/T-261014-518675-doc-27-status-expired-em-vez-de-critical-por-fus.json
