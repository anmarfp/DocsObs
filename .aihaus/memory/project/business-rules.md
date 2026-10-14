# Business rules

Markdown is authoritative; indexes only retrieve it.

As regras abaixo vêm da seção 6 do PRD (status "Aprovado, Implementado e
Validado"). Elas são registradas como **accepted** pela autoridade do PRD; o
comportamento do código é anotado separadamente quando diverge.

## Accepted rules

### RN-001 — Recálculo automático de status (matriz de cores)

- **status:** accepted
- **domain:** software
- **statement:** O status visual do documento é calculado no backend: `INDETERMINATE` sem vencimento; `RENEWAL_IN_PROGRESS` por sinalização manual; `EXPIRED` se vencido; `CRITICAL` se faltam `<= alert_lead_days` dias; senão `REGULAR`.
- **source**: `docs/PRD.md` (reviewed 824aace)
- **last-reviewed:** 824aace
- **links:** implements: [RF-004 via statusService], relates: [], decided-by: []

- Given um documento com vencimento em 10 dias e antecedência de 30 When o status é calculado Then o status é `CRITICAL`. Source: `backend/src/services/statusService.ts` (reviewed 824aace).
- Unresolved: o PRD/ARCHITECTURE dizem que o recálculo é agendado diariamente à meia-noite via `cronService.ts`, mas no código não há agendador; o recálculo em lote só roda por `POST /notifications/recalculate`. Source: `backend/src/controllers/notificationController.ts` (reviewed 824aace).

### RN-002 — Imutabilidade do histórico de renovações

- **status:** accepted
- **domain:** data
- **statement:** Ao renovar, a versão anterior é copiada para `document_versions` com numeração sequencial e preservada.
- **source**: `docs/PRD.md` (reviewed 824aace)
- **last-reviewed:** 824aace
- **links:** implements: [RF-003], relates: [RN-008], decided-by: []

- Given um documento renovado When uma nova versão é registrada Then a versão anterior permanece no histórico. Source: `docs/ARCHITECTURE.md` (reviewed 5186755).

### RN-003 — Alerta mandatório

- **status:** accepted
- **domain:** software
- **statement:** Todo documento com data de vencimento ativa gera notificações no período de antecedência configurado.
- **source**: `docs/PRD.md` (reviewed 824aace)
- **last-reviewed:** 824aace
- **links:** implements: [RF-007, RF-008], relates: [RN-004], decided-by: []

- Unresolved: `sendExpirationAlert` monta assunto/corpo e retorna `success: true` sem transporte de e-mail (nenhuma lib SMTP/API nas dependências); o envio real não está implementado. Source: `backend/src/services/notificationService.ts` (reviewed 824aace).

### RN-004 — Responsável condicional ao modo da empresa

- **status:** accepted
- **domain:** software
- **statement:** No modo `ALL_ADMINS` o campo Responsável é ocultado e todos os administradores recebem os alertas; no modo `ONLY_RESPONSIBLE` o campo é obrigatório e só o e-mail do responsável recebe.
- **source**: `docs/PRD.md` (reviewed 824aace)
- **last-reviewed:** 824aace
- **links:** implements: [RF-012], relates: [RN-003], decided-by: [ADR-L04]

- Given modo `ONLY_RESPONSIBLE` When o alerta é resolvido Then o destinatário é apenas o e-mail do responsável. Source: `backend/tests/notification-gcal.test.ts` (reviewed 824aace).

### RN-005 — Single-tenant no MVP

- **status:** accepted
- **domain:** architecture
- **statement:** O MVP atende uma única empresa/organização.
- **source**: `docs/PRD.md` (reviewed 824aace)
- **last-reviewed:** 824aace
- **links:** implements: [], relates: [], decided-by: []

### RN-006 — Arquivados visíveis só para ADMIN

- **status:** accepted
- **domain:** security
- **statement:** Usuários `OPERATIONAL` nunca recebem documentos arquivados nas consultas, e o filtro é omitido na UI.
- **source**: `docs/PRD.md` (reviewed 824aace)
- **last-reviewed:** 824aace
- **links:** implements: [RF-011], relates: [RN-009], decided-by: []

- Given um usuário OPERATIONAL When lista documentos Then a consulta força `isArchived = false` e o acesso direto a um arquivado é negado. Source: `backend/src/controllers/documentController.ts` (reviewed 824aace).

### RN-007 — Sincronização com Google Agenda

- **status:** accepted
- **domain:** software
- **statement:** Criação, edição, arquivamento e exclusão de documentos com vencimento disparam sincronização com o Google Agenda do usuário que cadastrou o documento, registrando `gcal_sync_logs`; falha de sync nunca bloqueia a resposta.
- **source**: `docs/ARCHITECTURE.md` (reviewed 5186755)
- **last-reviewed:** 824aace
- **links:** implements: [RF-005], relates: [], decided-by: [ADR-009]

- Given o criador do documento sem conta Google conectada When o documento é sincronizado Then um log `ERROR` é gravado. Source: `backend/src/services/gcalService.ts` (reviewed 824aace).

### RN-008 — Auditoria obrigatória

- **status:** accepted
- **domain:** security
- **statement:** Qualquer alteração em documentos insere atomicamente em `audit_logs` o autor, timestamp, ação (`CREATE`, `UPDATE`, `ARCHIVE`, `UNARCHIVE`, `DELETE`, `RENEW`) e diff JSON `old`/`new`.
- **source**: `docs/PRD.md` (reviewed 824aace)
- **last-reviewed:** 824aace
- **links:** implements: [RF-013], relates: [RN-002], decided-by: [ADR-A04]

### RN-009 — Gestão restrita a ADMIN

- **status:** accepted
- **domain:** security
- **statement:** Apenas `ADMIN` acessa `/usuarios`, `/auditoria`, `/configuracoes` e as rotas de API correspondentes.
- **source**: `docs/PRD.md` (reviewed 824aace)
- **last-reviewed:** 824aace
- **links:** implements: [RF-014], relates: [RN-006], decided-by: []

## Conflicts and gaps

Record unresolved gaps here; an owner's answer becomes a rule.

- Unresolved: arquivar documento — o `README.md` marca `PATCH /documents/:id/archive` como "Admin only", mas PRD/ARCHITECTURE permitem ao OPERATIONAL e a rota não tem `requireRole`. Source: `backend/src/routes/documentRoutes.ts` (reviewed 824aace).
- Unresolved: ARCHITECTURE §4 cita a categoria "Sem Vencimento" como gatilho de `INDETERMINATE`, mas `calculateDocumentStatus` só considera a ausência de data. Source: `backend/src/services/statusService.ts` (reviewed 824aace).
