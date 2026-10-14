---
id: T-261014-47eb46-doc-31-agendar-cron-e-enviar-e-mails-reais-de-ve
room: feature
external_id: "DOC-31"
created: 2026-10-14T14:33:22.311Z
---

# Goal

DOC-31 agendar cron e enviar e-mails reais de vencimento

## Acceptance

- [ ] Recalculo de status e digest de alertas agendados in-process (node-cron) diariamente a 00:00 no fuso de negocio, sem intervencao manual
- [ ] Envio real via SMTP (nodemailer) usando SMTP_HOST/PORT/USER/PASS/EMAIL_FROM
- [ ] Falha de SMTP ou SMTP nao configurado e registrada e nao retorna success: true
- [ ] Protecao contra dupla execucao (pg advisory lock)
- [ ] Testes cobrindo o agendamento (relogio congelado) e o caminho de erro do envio
- [ ] Entrega real em caixa Mailtrap ou equivalente (degradado sem credenciais)

## Context

- Linear DOC-31 (P0-1). Regras: RN-001, RN-003, RN-004. Depende de DOC-33 (env.ts) e DOC-27 (fuso).
- Mode: orquestrador + executor delegado em worktree isolada + judgment pass separado (projeto sem modo/Assignments). Autorizacao de merge: pedido do usuario em 2026-10-14.

## Owned files

backend/src/services/cronService.ts, backend/src/services/notificationService.ts, backend/src/services/mailService.ts (novo), backend/src/server.ts, backend/src/config/env.ts, backend/src/controllers/notificationController.ts, backend/package.json, backend/package-lock.json, .env.example, backend/tests/**, docs

## Business-rule gaps

- Assumed decision: cron in-process 00:00 APP_TIMEZONE; SMTP ausente => dispatched:false e log de erro, sem quebrar o boot.

## Log

- 2026-10-14 ingerido do Linear DOC-31 pelo orquestrador.

## Evidence
