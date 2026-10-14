---
id: T-261014-47eb46-doc-31-agendar-cron-e-enviar-e-mails-reais-de-ve
room: feature
external_id: "DOC-31"
created: 2026-10-14T14:33:22.311Z
---

# Goal

DOC-31 agendar cron e enviar e-mails reais de vencimento

## Acceptance

- [x] Recalculo de status e digest de alertas agendados in-process (node-cron) diariamente a 00:00 no fuso de negocio, sem intervencao manual
- [x] Envio real via SMTP (nodemailer) usando SMTP_HOST/PORT/USER/PASS/EMAIL_FROM
- [x] Falha de SMTP ou SMTP nao configurado e registrada e nao retorna success: true
- [x] Protecao contra dupla execucao (pg advisory lock)
- [x] Testes cobrindo o agendamento (relogio congelado) e o caminho de erro do envio
- [x] Entrega real em caixa Mailtrap ou equivalente (degradado sem credenciais)

## Context

- Linear DOC-31 (P0-1). Regras: RN-001, RN-003, RN-004. Depende de DOC-33 (env.ts) e DOC-27 (fuso).
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/src/services/cronService.ts, backend/src/services/notificationService.ts, backend/src/services/mailService.ts (novo), backend/src/server.ts, backend/src/config/env.ts, backend/src/controllers/notificationController.ts, backend/package.json, backend/package-lock.json, .env.example, backend/tests/**, docs

## Business-rule gaps

- Assumed decision: cron in-process 00:00 APP_TIMEZONE; SMTP ausente => dispatched:false e log de erro, sem quebrar o boot.

## Log

- 2026-10-14 ingerido do Linear DOC-31 pelo orquestrador.
- 2026-10-14 primeira execucao do Antigravity interrompida por pressao de memoria do sistema (Claude Code reaper); trabalho parcial descartado e reiniciado do zero em worktree Orca (doc-31-cron-email) a pedido do usuario.
- 2026-10-14 executor Antigravity (agy 1.3.5, gemini-3.8-flash-high, modo interativo em terminal Orca) entregou 0d1ce00 (base 8ba35c6), incluindo prova propria em Mailpit.
- 2026-10-14 judgment pass (orquestrador Claude, full): leitura de scheduler.ts, mailService.ts, notificationService.ts, cronService.ts, env.ts, server.ts, compose, docs. Worktree limpa em 0d1ce00: vitest 256/256, build 0, git grep process.env so em config/env.ts. Integracao real (postgres:16-alpine + axllent/mailpit descartaveis): executeDailyJob x2 em paralelo -> 1 skipped por pg_try_advisory_xact_lock, 1 executado; documento REGULAR->CRITICAL; Mailpit recebeu alerta critico + digest. E2E 19/19 em 0d1ce00. Rebase para 6734693 sobre 99efce2 (DOC-37): vitest 266/266, build 0, E2E 19/19 (start 14:43:48). Verdict: ship.
- Riscos residuais: lock evita concorrencia mas nao reexecucao sequencial (digest duplicado se 2 replicas disparam com segundos de diferenca; deploy atual e single-container); digest enviado mesmo com 0 pendencias (pre-existente); @types/node-cron 3 junto de node-cron 4 (build ok).

## Evidence

Artifact: .aihaus/memory/evidence/T-261014-47eb46-doc-31-agendar-cron-e-enviar-e-mails-reais-de-ve.json
