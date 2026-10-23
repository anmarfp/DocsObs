# PRD - Documento de Requisitos do Produto
## Sistema de Gestão e Acompanhamento de Vencimento de Documentos (DocsObs)

| Informação | Detalhe |
| :--- | :--- |
| **Projeto** | DocsObs - Gestão de Vencimento de Documentos |
| **Fase Atual** | Concluído / Em Produção (Fases 1 a 4 Concluídas) |
| **Status** | Aprovado, Implementado e Validado |
| **Versão** | 1.0.0 |
| **Última Atualização** | 2026-08-27 |
| **Documento Relacionado** | [ARCHITECTURE.md](./ARCHITECTURE.md) |

---

## 1. Visão Geral e Problema

### 1.1 Contexto e Problema
Na administração diária de empresas, o acompanhamento manual de datas de vencimento de documentos (como certidões negativas, licenças de operação, contratos de fornecedores, obrigações trabalhistas, apólices de seguro, licenças sanitárias/ambientais, entre outros) através de planilhas desatualizadas ou e-mails causa retrabalho e riscos operacionais graves. A perda de prazos resulta em multas, suspensão de alvarás, bloqueios contratuais e impedimento de participação em licitações.

### 1.2 Solução Entregue
O sistema **DocsObs** é uma plataforma web moderna, responsiva e Local-First, focada na visualização rápida e proativa do status de vencimento dos documentos da empresa, com sistema visual por matriz de cores, alertas automáticos multicanal, sincronização com calendário, trilha de auditoria imutável (com visualização de diff) e controle rigoroso de acessos baseado em perfis (RBAC).

---

## 2. Objetivos e Métricas de Sucesso

- **Zero Vencimentos Não Detectados**: 100% dos documentos cadastrados geram alertas prévios parametrizados e eventos na agenda.
- **Consulta Instantânea**: Qualquer documento ou certidão é localizado em menos de 1 segundo através de busca e filtros combinados.
- **Rastreabilidade e Imutabilidade**: Trilha de auditoria detalhada com registro de autor, timestamp e diff de campos alterados (`old` vs `new`) para 100% das mutações.
- **Visibilidade Executiva e Compliance**: Dashboard em tempo real com matriz de cores, indicadores de conformidade e recorte de vencimentos para os próximos 30 dias.
- **Confiabilidade da Entrega**: 187/187 casos de testes automatizados (unitários, integração e E2E) 100% aprovados.

---

## 3. Personas e Perfis de Usuários (RBAC)

| Perfil | Descrição | Permissões / Necessidades |
| :--- | :--- | :--- |
| **Administrador / Gestor** (`ADMIN`) | Diretores, gerentes e administradores do sistema. | Acesso irrestrito: Painel, Documentos (incluindo arquivados), Criação/Edição/Renovação, Exclusão permanente (Hard Delete), Gestão de Categorias, Visão de Calendário e Sincronização, Trilha de Auditoria (Audit Logs), Exportação de Relatórios, Gestão Completa de Usuários (criação, ativação/inativação, redefinição de senhas) e Configurações Globais da Empresa. |
| **Operacional / Analista** (`OPERATIONAL`) | Assistentes e analistas administrativos. | Operações do dia a dia: Painel, Cadastro e Edição de Documentos, Upload de Anexos, Renovação com versionamento, Arquivamento (Soft Delete) e Consulta de Calendário. *(Bloqueio de acesso a documentos arquivados, exclusão permanente, trilha de auditoria, gestão de usuários e configurações globais)*. |

---

## 4. Requisitos Funcionais (RF) — Entregues e Validados

### 4.1 Módulo de Cadastro e Armazenamento
- **[RF-001] Cadastro Completo de Documentos**:
  - Título/Nome do documento (obrigatório).
  - Categoria/Tipo vinculada ao cadastro dinâmico (obrigatório).
  - Entidade/Órgão Emissor (opcional).
  - Data de Emissão e Data de Vencimento (obrigatórias; suporte a validade permanente/indeterminada).
  - Antecedência do Alerta customizável por documento (padrão 30 dias).
  - Responsável pelo Documento (nome e e-mail — *exibição e obrigatoriedade condicionais conforme configuração da empresa*).
  - Arquivo Anexo (PDF, PNG, JPG até 10 MB por arquivo com validação de MIME type e assinatura de bytes).
  - Observações e Instruções para Renovação.
- **[RF-002] Categorias Personalizadas com Cores**: Cadastro, listagem e exclusão controlada de categorias (exclusão bloqueada caso existam documentos vinculados).
- **[RF-003] Histórico de Renovações e Versionamento (RN-002)**: Ao renovar um documento com nova data e novo comprovante, a versão atual é arquivada na tabela `document_versions` e o documento principal é atualizado com novo número de versão e status recalculado.
- **[RF-010] Exclusão Permanente de Documentos**: Hard delete disponível exclusivamente para perfil `ADMIN`, expurgando registro, versões associadas e arquivo físico do storage.
- **[RF-011] Arquivamento de Documentos (Soft Delete)**: Alternância de arquivamento para ocultar documentos da listagem padrão; documentos arquivados são visíveis exclusivamente para `ADMIN`.

### 4.2 Módulo de Visualização, Dashboard e Calendário
- **[RF-004] Painel Visual por Matriz de Cores (RN-001)**:
  - 🔴 **Vencido (`EXPIRED`)**: Data de vencimento ultrapassada.
  - 🟡 **Alerta Crítico (`CRITICAL`)**: Vencimento dentro da janela de antecedência (`<= alert_lead_days`).
  - 🔵 **Em Renovação (`RENEWAL_IN_PROGRESS`)**: Sinalizador manual indicando protocolo em andamento.
  - 🟢 **Regular / Em Dia (`REGULAR`)**: Vencimento regular fora da janela crítica.
  - ⚪ **Indeterminado (`INDETERMINATE`)**: Documentos sem data de vencimento (validade permanente).
- **[RF-005] Calendário e Sincronização de Agenda**:
  - Visualização mensal/semanal de eventos com filtros por período.
  - Sincronização real com o Google Agenda pessoal de cada usuário, via conexão
    OAuth2 individual (modelo de conta por usuário — ADR-009): cada Administrador
    ou Operacional conecta sua própria conta Google em Configurações antes de
    sincronizar.
  - Disparo automático de sincronização na criação, edição, renovação, arquivamento e
    exclusão de documentos com vencimento (RN-007), além do disparo manual pelo
    botão "Sincronizar com Agenda".
  - Consulta de logs de sincronização (`gcal_sync_logs`) restrita a `ADMIN`.
- **[RF-006] Busca Avançada e Filtros**: Filtragem em tempo real por termo de busca, categoria, responsável, status visual e alternância para inclusão de arquivados.

### 4.3 Módulo de Notificações e Configuração da Empresa
- **[RF-007] Alertas Programados de Vencimento**: Rotina automatizada de verificação diária e notificação de prazos.
- **[RF-008] Daily/Weekly Digest Consolidado**: Resumo consolidado de pendências e documentos a vencer.
- **[RF-012] Configuração Global de Notificação por Empresa (RN-004)**:
  - **Modo "Notificar Todos os Administradores" (`ALL_ADMINS`)**: Todos os administradores recebem os alertas. O campo "Responsável" é ocultado no formulário de cadastro.
  - **Modo "Notificar Apenas Responsável" (`ONLY_RESPONSIBLE`)**: O campo "Responsável" torna-se obrigatório no cadastro e recebe diretamente as notificações.

### 4.4 Módulo de Auditoria e Relatórios
- **[RF-009] Exportação de Relatórios Executivos**: Exportação de relatórios tabulares em formato CSV (formatado com UTF-8 BOM e delimitador compatível com Excel) e JSON, com filtros por status e intervalo de datas.
- **[RF-013] Trilha de Auditoria com Diff de Alterações (RN-008)**:
  - Registro automático de autor, timestamp, ação (`CREATE`, `UPDATE`, `ARCHIVE`, `UNARCHIVE`, `DELETE`, `RENEW`) e diff JSON detalhando o estado anterior (`old`) e novo (`new`).
  - Interface visual com modal de detalhes e comparador de diff em destaque.

### 4.5 Módulo de Gestão de Usuários e Autenticação (RBAC)
- **[RF-014] Gestão Completa de Usuários e Controle de Acesso**:
  - Autenticação com JWT e senhas criptografadas via BCrypt.
  - Cadastro de usuários com perfis `ADMIN` and `OPERATIONAL`.
  - Ativação/inativação de contas (com proteção contra auto-inativação da própria conta logada).
  - Redefinição administrativa de senhas.
  - Bloqueio estrito de rotas de API e páginas de frontend baseado em RBAC.

---

## 5. Requisitos Não-Funcionais (RNF) — Cumpridos

- **[RNF-001] Usabilidade e Interface Moderna**: SPA em React 18 com Tailwind CSS, Design System escuro *Midnight Navy*, responsividade completa (Mobile, Tablet, Desktop), feedback visual por toasts e modais acessíveis.
- **[RNF-002] Alta Performance**: Resposta da API REST em < 200ms e carregamento inicial do frontend estático servido por Nginx otimizado.
- **[RNF-003] Segurança Robusta**: Autenticação stateless via JWT, hash BCrypt (salt rounds 10), sanitização e validação com Zod, e proteção de rotas com RBAC no backend e guards no React Router.
- **[RNF-004] Arquitetura Local-First Containerizada**: Inicialização completa do ecossistema (PostgreSQL, Backend API, Frontend Nginx) com 1 único comando via Docker Compose.
- **[RNF-005] Qualidade e Testabilidade**: 100% dos fluxos cobertos por testes automatizados (140 unitários backend + 28 unitários frontend + 19 E2E integrados em Docker).

---

## 6. Regras de Negócio (RN) — Implementação Consolidada

- **[RN-001] Troca Automática e Recálculo de Status**: Status recalculado dinamicamente no backend (`statusService.ts`) e agendado via rotina diária (`cronService.ts`).
- **[RN-002] Imutabilidade do Histórico de Renovações**: Ao renovar, a versão anterior é clonada para `document_versions` com numeração sequencial e metadados preservados.
- **[RN-003] Alerta Mandatório**: Todo documento com data de vencimento ativa gera notificações no período de antecedência configurado.
- **[RN-004] Condicional Responsável vs Modo da Empresa**: A presença e obrigatoriedade do campo "Responsável" no frontend e backend segue estritamente o valor de `company_config.notification_mode`.
- **[RN-005] Single-Tenant no MVP**: Estrutura otimizada para operação de uma empresa/organização no MVP, com isolamento e portabilidade de dados.
- **[RN-006] Restrição de Visibilidade de Arquivados**: Usuários `OPERATIONAL` nunca recebem documentos arquivados nas consultas, e o filtro é omitido na UI.
- **[RN-007] Sincronização com Agenda**: Operações de criação, edição, renovação, arquivamento e exclusão de documentos com vencimento disparam eventos de sincronização com registro de logs em `gcal_sync_logs` (falhas de sincronização não bloqueiam a operação).
- **[RN-008] Registro Obrigatório de Auditoria**: Qualquer alteração em documentos dispara inserção atômica em `audit_logs` com diff serializado em JSON.
- **[RN-009] Restrição Administrativa de Gestão**: Apenas usuários com role `ADMIN` possuem permissão para acessar `/usuarios`, `/auditoria`, `/configuracoes` e rotas correspondentes da API.

---

## 7. Entregáveis do MVP (Concluídos)

1. ✅ **Autenticação, RBAC e Gestão de Usuários** (Admin e Operacional).
2. ✅ **Módulo de Documentos** (CRUD completo, validação multipart, upload de anexos de até 10 MB, download autenticado).
3. ✅ **Ciclo de Renovação com Versionamento e Histórico** (Tabela `document_versions`).
4. ✅ **Dashboard com Matriz Visual de Cores** (Vencido, Crítico, Em Renovação, Regular, Indeterminado) e Métricas de Conformidade.
5. ✅ **Configurações da Empresa** (Alternância de modo de notificação `ALL_ADMINS` vs `ONLY_RESPONSIBLE`).
6. ✅ **Módulo de Calendário e Sincronização de Agenda** (Visão mensal e histórico de logs).
7. ✅ **Trilha de Auditoria com Visualizador de Diff** (Ações de Create, Update, Renew, Archive, Delete).
8. ✅ **Exportação de Relatórios Executivos** (CSV e JSON com filtros avançados).
9. ✅ **Ambiente Docker Compose Unificado** (PostgreSQL 16 + Backend Node.js + Frontend Nginx SPA).
10. ✅ **Suíte Completa de Testes Automatizados** (187/187 testes passando).

---

## 8. Credenciais Padrão do Ambiente de Demonstração (Seed)

| Perfil | E-mail de Acesso | Senha Padrão | Escopo de Acesso |
| :--- | :--- | :--- | :--- |
| **Administrador** | `admin@docsobs.com.br` | definida por `ADMIN_SEED_PASSWORD` (ver README, seção Usuários Iniciais) | Acesso Irrestrito (Gestão, Auditoria, Configurações, Documentos, Relatórios) |
| **Operacional** | `operacional@docsobs.com.br` | definida por `OPERATIONAL_SEED_PASSWORD` | Acesso Operacional (Documentos, Renovações, Calendário, Dashboard) |

---

## 9. Roadmap Futuro (Pós-MVP)

1. **Multi-Tenancy**: Suporte a múltiplas filiais, empresas e centros de custos isolados por tenant.
2. **Integração WhatsApp / SMS**: Notificações ativas de vencimento via WhatsApp Business API (Twilio / Z-API).
3. **Leitura Inteligente com OCR e IA**: Extração automática de datas de emissão/vencimento e órgão emissor a partir de arquivos PDF anexados.
4. **Integração Direta com Órgãos Públicos**: Consulta e renovação automatizada de Certidões Negativas de Débitos (CNDs) via APIs governamentais (Receita Federal, FGTS, Trabalhista).
