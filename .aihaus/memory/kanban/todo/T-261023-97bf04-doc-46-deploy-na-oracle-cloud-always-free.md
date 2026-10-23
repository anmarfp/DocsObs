---
id: T-261023-97bf04-doc-46-deploy-na-oracle-cloud-always-free
room: feature
external_id: "DOC-46"
created: 2026-10-23T20:32:01.317Z
---

# Goal

DOC-46: hospedar o DocsObs gratuitamente para 1 usuário na Oracle Cloud Always Free, com HTTPS, banco e API sem porta pública, alertas por e-mail, Google Agenda e backup diário. Plano: `docs/deploy/oracle-cloud.md`.

## Acceptance

- [ ] `https://<DOMAIN>` responde com certificado válido e as portas 5432 e 3001 não aceitam conexão externa
- [ ] Login, CRUD de documentos, upload/download de anexo, dashboard e calendário funcionam em produção
- [ ] Alerta por e-mail recebido e Google Agenda conectado com evento sincronizado
- [ ] `scripts/backup.sh` agendado no host e uma restauração testada com sucesso
- [ ] Runbook de deploy, atualização, backup e restauração promovido em `.aihaus/memory/project/procedures.md` e topologia em `deployment.md`

## Context

- Linear: DOC-46. Pedido do dono em 2026-10-23: plano versionado no GitHub; a implementação continua em outro computador.
- Plano completo, com fases, arquivos a criar, variáveis e riscos: `docs/deploy/oracle-cloud.md` (commit deste PR).
- Dependência: DOC-44 (criptografia dos tokens OAuth) introduz `GOOGLE_TOKEN_ENCRYPTION_KEY`, obrigatória em produção com Google configurado.
- Regras relacionadas: DOC-31/DOC-41 (cron e digest), DOC-32 (seed), DOC-33 (env), ADR-009/RN-007 (Google Agenda).
- Mode: a definir por quem retomar (sugestão: normal, com judgment pass separado antes do merge da Fase 1).

## Owned files

- docker-compose.prod.yml, deploy/Caddyfile, .env.production.example, scripts/backup.sh, scripts/restore.sh, README.md, docs/deploy/oracle-cloud.md
- .aihaus/memory/kanban/**, .aihaus/memory/evidence/**, .aihaus/memory/project/procedures.md, .aihaus/memory/project/deployment.md

## Business-rule gaps

- none

## Log

- 2026-10-23 criado pelo orquestrador; plano escrito em `docs/deploy/oracle-cloud.md`. Nada implementado ainda. Próximo passo: Fase 0 (contas) e Fase 1 (arquivos do repositório) conforme o plano.

## Evidence
