# Glossary

| Term | Meaning | Source or owner |
|---|---|---|
| DocsObs | Sistema de Gestão e Acompanhamento de Vencimento de Documentos. | Verified. Source: `docs/PRD.md` (reviewed 824aace) |
| Matriz de Cores | Status visual: 🔴 Vencido (`EXPIRED`), 🟡 Alerta Crítico (`CRITICAL`), 🔵 Em Renovação (`RENEWAL_IN_PROGRESS`), 🟢 Regular (`REGULAR`), ⚪ Indeterminado (`INDETERMINATE`). | Verified. Source: `docs/PRD.md` (reviewed 824aace) |
| Antecedência do Alerta (`alert_lead_days`) | Dias antes do vencimento em que o documento passa a `CRITICAL`; padrão 30, configurável por documento. | Verified. Source: `docs/ARCHITECTURE.md` (reviewed 824aace) |
| Arquivamento (Soft Delete) | Oculta o documento da listagem padrão (`is_archived`); arquivados só são visíveis a `ADMIN`. | Verified. Source: `docs/PRD.md` (reviewed 824aace) |
| Exclusão Permanente (Hard Delete) | Remove registro, versões e arquivo físico; exclusiva de `ADMIN`. | Verified. Source: `docs/PRD.md` (reviewed 824aace) |
| Renovação / Versão | Substituição de datas e anexo com cópia da versão anterior em `document_versions`. | Verified. Source: `docs/ARCHITECTURE.md` (reviewed 824aace) |
| Trilha de Auditoria (Audit Log) | Registro em `audit_logs` de autor, timestamp, ação e diff `old`/`new`. | Verified. Source: `docs/ARCHITECTURE.md` (reviewed 824aace) |
| Modo de Notificação | Configuração global `ALL_ADMINS` ou `ONLY_RESPONSIBLE` (RN-004). | Verified. Source: `docs/PRD.md` (reviewed 824aace) |
| RBAC | Controle de acesso por papel: `ADMIN` e `OPERATIONAL`. | Verified. Source: `docs/PRD.md` (reviewed 824aace) |
| Sync Log | Registro em `gcal_sync_logs` com status `SYNCED`, `ERROR` ou `DELETED`. | Verified. Source: `docs/ARCHITECTURE.md` (reviewed 824aace) |
| Daily Digest | Resumo consolidado de documentos que exigem ação, para administradores ativos (RF-008). | Verified. Source: `docs/PRD.md` (reviewed 824aace) |
| Midnight Navy | Tema escuro do design system do frontend. | Verified. Source: `docs/PRD.md` (reviewed 824aace) |
