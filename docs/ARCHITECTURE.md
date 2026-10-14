# Especificação de Arquitetura do Sistema — DocsObs

| Informação | Detalhe |
| :--- | :--- |
| **Projeto** | DocsObs — Gestão de Vencimento de Documentos |
| **Fase Atual** | Concluído e Validado (Fases 1 a 4 Concluídas) |
| **Status** | Implementado, Validado e Operacional |
| **Versão** | 1.1.0 |
| **Última Atualização** | 2026-08-27 |
| **Documento Relacionado** | [PRD.md](./PRD.md) |

---

## 1. Visão Geral da Arquitetura

O sistema **DocsObs** é construído sob uma arquitetura desacoplada e conteinerizada (Client-Server / RESTful API / Local-First), projetada para responder com alta performance (tempo de resposta < 200ms), garantindo auditoria imutável, sincronização de prazos e controle estrito de acessos baseado em perfis (RBAC).

```mermaid
flowchart TD
    subgraph Client ["Camada de Apresentação (Navegador Web)"]
        Browser["Usuário (Browser Web)"]
    end

    subgraph DockerEnv ["Ambiente Containerizado (Docker Compose)"]
        subgraph FrontendBox ["Frontend Container (Porta 80 / Host 3000)"]
            Nginx["Nginx Alpine (Reverse Proxy & Static Server)"]
            SPA["React 18 SPA (Vite / Tailwind Midnight Navy / Lucide / Recharts)"]
        end

        subgraph BackendBox ["Backend Container (Porta 3001)"]
            Express["Express 4 REST API (Node.js 20 / TypeScript)"]
            AuthModule["Módulo de Autenticação & RBAC (JWT + BCrypt)"]
            DocModule["Módulo de Documentos & Versionamento"]
            AuditModule["Módulo de Trilha de Auditoria (Audit Logs)"]
            StatusModule["Motor de Status & Cron Diário (00:00)"]
            ReportModule["Módulo de Relatórios (CSV / JSON)"]
            GCalModule["Módulo de Sincronização de Calendário"]
            Storage["Storage de Arquivos (Local Disk /app/uploads)"]
            Prisma["Prisma ORM 6"]
        end

        subgraph DBBox ["Database Container (Porta 5432)"]
            PostgreSQL[("PostgreSQL 16 Alpine\n(Schema Relacional + Índices)")]
            PGVolume["Volume Persistente (postgres_data)"]
        end
    end

    Browser -->|HTTP :3000| Nginx
    Nginx -->|Serve SPA / Fallback index.html| SPA
    Nginx -->|Proxy /api/v1/*| Express
    Express --> AuthModule
    Express --> DocModule
    Express --> AuditModule
    Express --> StatusModule
    Express --> ReportModule
    Express --> GCalModule
    DocModule --> Storage
    Express --> Prisma
    Prisma --> PostgreSQL
    PostgreSQL --> PGVolume
```

---

## 2. Modelo de Dados (ERD — Entidade e Relacionamento)

```mermaid
erDiagram
    COMPANY_CONFIG {
        uuid id PK
        string notification_mode "ALL_ADMINS | ONLY_RESPONSIBLE"
        datetime updated_at
        uuid updated_by_id FK
    }

    USER {
        uuid id PK
        string name
        string email UK
        string password_hash
        string role "ADMIN | OPERATIONAL"
        boolean is_active
        datetime created_at
        datetime updated_at
    }

    DOCUMENT_CATEGORY {
        uuid id PK
        string name UK
        string color_hex
        string description
        datetime created_at
    }

    DOCUMENT {
        uuid id PK
        string title
        uuid category_id FK
        string issuing_body
        date issue_date
        date expiration_date
        int alert_lead_days
        string status "EXPIRED | CRITICAL | RENEWAL_IN_PROGRESS | REGULAR | INDETERMINATE"
        string responsible_name
        string responsible_email
        string attachment_url
        string attachment_filename
        int file_size_bytes
        string file_mime_type
        text notes
        boolean is_archived
        uuid created_by_id FK
        datetime created_at
        datetime updated_at
    }

    DOCUMENT_VERSION {
        uuid id PK
        uuid document_id FK
        int version_number
        date issue_date
        date expiration_date
        string attachment_url
        string attachment_filename
        int file_size_bytes
        string file_mime_type
        text notes
        uuid renewed_by_id FK
        datetime created_at
    }

    AUDIT_LOG {
        uuid id PK
        uuid document_id FK
        uuid user_id FK
        string user_name
        string action "CREATE | UPDATE | ARCHIVE | UNARCHIVE | DELETE | RENEW"
        jsonb diff_data
        datetime timestamp
    }

    GCAL_SYNC_LOG {
        uuid id PK
        uuid document_id FK
        string gcal_event_id
        string status "SYNCED | ERROR | DELETED"
        datetime last_synced_at
        text error_message
    }

    GOOGLE_OAUTH_TOKEN {
        uuid id PK
        uuid user_id FK UK
        string access_token
        string refresh_token
        datetime expiry_date
        string scope
        datetime created_at
        datetime updated_at
    }

    USER ||--o{ DOCUMENT : "cadastrou"
    USER ||--o{ DOCUMENT_VERSION : "renovou"
    USER ||--o{ AUDIT_LOG : "executou_acao"
    USER ||--o{ COMPANY_CONFIG : "alterou_configuracao"
    USER ||--o| GOOGLE_OAUTH_TOKEN : "conectou"
    DOCUMENT_CATEGORY ||--o{ DOCUMENT : "classifica"
    DOCUMENT ||--o{ DOCUMENT_VERSION : "possui_versoes"
    DOCUMENT ||--o{ AUDIT_LOG : "registra_alteracoes"
    DOCUMENT ||--o{ GCAL_SYNC_LOG : "sincroniza_evento"
```

---

## 3. Dicionário de Dados e Estrutura de Tabelas

### 3.1 Tabela: `company_configs` (Configuração Global da Empresa)
- `id` (UUID, PK): Identificador único da configuração.
- `notification_mode` (VARCHAR(30), NOT NULL):
  - `'ALL_ADMINS'`: Todos os Administradores recebem alertas. O campo "Responsável" é **oculto** na UI e nulo no banco.
  - `'ONLY_RESPONSIBLE'`: Apenas o e-mail do Responsável cadastrado no documento recebe alertas. O campo "Responsável" é **obrigatório**.
- `updated_at` (TIMESTAMP, NOT NULL): Data e hora da última alteração.
- `updated_by_id` (UUID, FK -> `users.id`): ID do Administrador que atualizou.

### 3.2 Tabela: `users` (Usuários e Controle de Acesso)
- `id` (UUID, PK): Identificador único do usuário.
- `name` (VARCHAR(150), NOT NULL): Nome completo.
- `email` (VARCHAR(150), UNIQUE, NOT NULL): E-mail institucional normalizado em minúsculas.
- `password_hash` (VARCHAR(255), NOT NULL): Hash seguro gerado via BCrypt (salt rounds 10).
- `role` (VARCHAR(20), NOT NULL): Papel de acesso:
  - `'ADMIN'`: Acesso irrestrito (Auditoria, Gestão de Usuários, Configurações, Documentos Arquivados, Hard Delete).
  - `'OPERATIONAL'`: Acesso a cadastro, edição, renovação, upload e consulta de calendário.
- `is_active` (BOOLEAN, DEFAULT TRUE): Status da conta (bloqueia login quando `false`).
- `created_at` (TIMESTAMP, DEFAULT NOW()): Data de cadastro.
- `updated_at` (TIMESTAMP, DEFAULT NOW()): Data da última alteração.

### 3.3 Tabela: `document_categories` (Categorias de Documentos)
- `id` (UUID, PK): Identificador único da categoria.
- `name` (VARCHAR(100), UNIQUE, NOT NULL): Nome da categoria (ex: Fiscal, Trabalhista, Licenças, Contratos).
- `color_hex` (VARCHAR(7), NOT NULL): Cor hexadecimal para identificação visual em badges.
- `description` (VARCHAR(255), NULLABLE): Descrição detalhada da categoria.
- `created_at` (TIMESTAMP, DEFAULT NOW()): Data de cadastro.

### 3.4 Tabela: `documents` (Cadastro Principal de Documentos)
- `id` (UUID, PK): Identificador do documento.
- `title` (VARCHAR(200), NOT NULL): Nome/título do documento.
- `category_id` (UUID, FK -> `document_categories.id`, NOT NULL): Categoria associada.
- `issuing_body` (VARCHAR(150), NULLABLE): Entidade ou órgão emissor.
- `issue_date` (DATE, NOT NULL): Data de emissão.
- `expiration_date` (DATE, NULLABLE): Data de vencimento (NULL = Validade Indeterminada / Permanente).
- `alert_lead_days` (INT, DEFAULT 30): Antecedência em dias para disparar alertas críticos.
- `status` (VARCHAR(30), NOT NULL): Status visual calculado:
  - `'EXPIRED'` (🔴 Vencido)
  - `'CRITICAL'` (🟡 Alerta Crítico)
  - `'RENEWAL_IN_PROGRESS'` (🔵 Em Renovação)
  - `'REGULAR'` (🟢 Regular / Em Dia)
  - `'INDETERMINATE'` (⚪ Validade Permanente)
- `responsible_name` (VARCHAR(150), NULLABLE): Nome do responsável (condicional).
- `responsible_email` (VARCHAR(150), NULLABLE): E-mail do responsável (condicional).
- `attachment_url` (VARCHAR(500), NULLABLE): Caminho relativo do arquivo no storage.
- `attachment_filename` (VARCHAR(255), NULLABLE): Nome original do arquivo anexado.
- `file_size_bytes` (INT, NULLABLE): Tamanho em bytes (limite de 10 MB = 10.485.760 bytes).
- `file_mime_type` (VARCHAR(100), NULLABLE): MIME type (`application/pdf`, `image/png`, `image/jpeg`).
- `notes` (TEXT, NULLABLE): Instruções e observações de renovação.
- `is_archived` (BOOLEAN, DEFAULT FALSE): Soft delete (documento arquivado).
- `created_by_id` (UUID, FK -> `users.id`): Usuário criador do registro.
- `created_at` (TIMESTAMP, DEFAULT NOW()): Data de criação.
- `updated_at` (TIMESTAMP, DEFAULT NOW()): Data da última atualização.

### 3.5 Tabela: `document_versions` (Histórico de Renovações)
- `id` (UUID, PK): Identificador da versão histórica.
- `document_id` (UUID, FK -> `documents.id`, NOT NULL): Documento de referência.
- `version_number` (INT, NOT NULL): Número sequencial da versão arquivada (1, 2, 3...).
- `issue_date` (DATE, NOT NULL): Data de emissão da versão antiga.
- `expiration_date` (DATE, NOT NULL): Data de vencimento da versão antiga.
- `attachment_url` (VARCHAR(500), NULLABLE): Link do anexo histórico.
- `attachment_filename` (VARCHAR(255), NULLABLE): Nome do anexo histórico.
- `file_size_bytes` (INT, NULLABLE): Tamanho do arquivo histórico.
- `file_mime_type` (VARCHAR(100), NULLABLE): MIME type do arquivo histórico.
- `notes` (TEXT, NULLABLE): Observações registradas na renovação.
- `renewed_by_id` (UUID, FK -> `users.id`): Usuário que efetuou a renovação.
- `created_at` (TIMESTAMP, DEFAULT NOW()): Data do registro da versão.

### 3.6 Tabela: `audit_logs` (Trilha de Auditoria Imutável — RN-008)
- `id` (UUID, PK): Identificador do log.
- `document_id` (UUID, FK -> `documents.id`, NULLABLE): Documento auditado (NULL se exclusão definitiva).
- `user_id` (UUID, FK -> `users.id`, NOT NULL): Autor da ação.
- `user_name` (VARCHAR(150), NOT NULL): Nome do usuário no momento da ação.
- `action` (VARCHAR(30), NOT NULL): `'CREATE'`, `'UPDATE'`, `'ARCHIVE'`, `'UNARCHIVE'`, `'DELETE'`, `'RENEW'`.
- `diff_data` (JSONB, NOT NULL): Objeto JSON detalhado com valores anteriores (`old`) e novos (`new`).
- `timestamp` (TIMESTAMP, DEFAULT NOW()): Timestamp exato da operação.

### 3.7 Tabela: `gcal_sync_logs` (Logs de Sincronização de Calendário)
- `id` (UUID, PK): Identificador do log de sincronização.
- `document_id` (UUID, FK -> `documents.id`, NULLABLE): Documento associado ao evento.
- `gcal_event_id` (VARCHAR(255), NULLABLE): Identificador real do evento retornado pela Google Calendar API.
- `status` (VARCHAR(30), NOT NULL):
  - `'SYNCED'`: Evento criado ou atualizado com sucesso no Google Agenda do usuário.
  - `'ERROR'`: Falha na sincronização (token ausente/revogado, sem rede, quota excedida, etc. — `error_message` traz o detalhe).
  - `'DELETED'`: Evento removido/cancelado no Google Agenda após arquivamento ou exclusão do documento.
- `last_synced_at` (TIMESTAMP, DEFAULT NOW()): Data e hora da sincronização.
- `error_message` (TEXT, NULLABLE): Detalhes de eventuais falhas.

### 3.8 Tabela: `google_oauth_tokens` (Credenciais OAuth2 do Google Agenda por Usuário — ADR-009)
- `id` (UUID, PK): Identificador do registro de credencial.
- `user_id` (UUID, FK -> `users.id`, UNIQUE, NOT NULL): Usuário dono da conexão (uma única conta Google conectada por usuário).
- `access_token` (VARCHAR, NOT NULL): Token de acesso de curta duração usado nas chamadas à Google Calendar API.
- `refresh_token` (VARCHAR, NOT NULL): Token de longa duração usado para renovar o `access_token` automaticamente quando expira, sem exigir nova autorização do usuário.
- `expiry_date` (TIMESTAMP, NOT NULL): Momento de expiração do `access_token` vigente.
- `scope` (VARCHAR, NOT NULL): Escopo OAuth concedido pelo usuário (`https://www.googleapis.com/auth/calendar.events`).
- `created_at` (TIMESTAMP, DEFAULT NOW()): Data da primeira conexão.
- `updated_at` (TIMESTAMP, DEFAULT NOW()): Data da última renovação/atualização do token.

---

## 4. Matriz de Cores e Lógica de Cálculo de Status (RN-001)

A lógica de cálculo do status visual é unificada no serviço `statusService.ts` e executada de forma atômica:

```
SE expiration_date É NULL OU tipo É "Sem Vencimento":
    Status = ⚪ INDETERMINATE (Validade Permanente)
SENÃO SE status_manual É "RENEWAL_IN_PROGRESS" (Em Renovação):
    Status = 🔵 RENEWAL_IN_PROGRESS (Em Renovação)
SENÃO SE DataAtual > expiration_date:
    Status = 🔴 EXPIRED (Vencido)
SENÃO SE (expiration_date - DataAtual em dias) <= alert_lead_days:
    Status = 🟡 CRITICAL (Alerta Crítico)
SENÃO:
    Status = 🟢 REGULAR (Em Dia)
```

- **Recálculo em Tempo Real**: Executado a cada mutação (criação, edição, renovação).
- **Recálculo Batch Agendado**: Executado automaticamente diariamente à meia-noite (`00:00:00` no fuso `APP_TIMEZONE`) via scheduler in-process (`node-cron`) protegido por lock consultivo transacional PostgreSQL (`pg_try_advisory_xact_lock`), executando `recalculateAllStatuses()` e `runDailyDigestJob()` e disparando os alertas reais via SMTP (`nodemailer`).

---

## 5. Matriz de Controle de Acesso Baseado em Papéis (RBAC — RF-014)

| Funcionalidade / Recurso | Rota de API | Administrador (`ADMIN`) | Operacional (`OPERATIONAL`) |
| :--- | :--- | :---: | :---: |
| Autenticação e Consulta de Perfil | `POST /auth/login`, `GET /auth/me` | ✅ Permitido | ✅ Permitido |
| Listar e Filtrar Documentos | `GET /documents` | ✅ Permitido (com arquivados) | ✅ Permitido (sem arquivados) |
| Criar e Editar Documentos | `POST /documents`, `PUT /documents/:id` | ✅ Permitido | ✅ Permitido |
| Download de Anexos | `GET /uploads/:arquivo` | ✅ Permitido | ✅ Permitido |
| Renovar Documento | `POST /documents/:id/renew` | ✅ Permitido | ✅ Permitido |
| Arquivar Documento (Soft Delete) | `PATCH /documents/:id/archive` | ✅ Permitido | ✅ Permitido |
| Excluir Permanentemente (Hard Delete) | `DELETE /documents/:id` | ✅ Permitido | ❌ 403 Forbidden |
| Gestão de Categorias | `POST /categories`, `DELETE /categories/:id` | ✅ Permitido | ❌ 403 Forbidden |
| Visualizar Trilha de Auditoria | `GET /audit-logs`, `GET /audit-logs/:id` | ✅ Permitido | ❌ 403 Forbidden |
| Exportar Relatórios (CSV/JSON) | `GET /reports/export`, `GET /reports/summary` | ✅ Permitido | ✅ Permitido |
| Visualizar Calendário | `GET /calendar/events` | ✅ Permitido | ✅ Permitido |
| Sincronizar Agenda & Logs | `POST /calendar/sync`, `GET /calendar/sync-logs` | ✅ Permitido | ❌ 403 Forbidden (Logs) |
| Gestão de Usuários (CRUD/Status/Senha) | `/users/*` | ✅ Permitido | ❌ 403 Forbidden |
| Configurações da Empresa | `GET /company/config`, `PUT /company/config` | ✅ Permitido | ❌ 403 Forbidden |
| Recálculo / Digest Manual | `/notifications/*` | ✅ Permitido | ❌ 403 Forbidden |

---

## 6. Fluxos de Trabalho Principais

### 6.1 Cadastro com Validação Condicional de Responsável (RN-004)

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuário (Admin / Operacional)
    participant UI as Frontend React (AppShell)
    participant API as Backend Express API
    participant DB as PostgreSQL 16
    participant Storage as Storage de Anexos

    User->>UI: Abre modal "Novo Documento"
    UI->>API: GET /api/v1/company/config
    API-->>UI: Retorna { notificationMode: 'ALL_ADMINS' | 'ONLY_RESPONSIBLE' }
    alt Mode == 'ALL_ADMINS'
        UI->>UI: Oculta campos de Responsável (Nome / E-mail)
    else Mode == 'ONLY_RESPONSIBLE'
        UI->>UI: Exibe campos de Responsável (Obrigatórios)
    end
    User->>UI: Preenche formulário + Anexa PDF/PNG/JPG (<=10MB) + Submete
    UI->>API: POST /api/v1/documents (multipart/form-data com Bearer JWT)
    API->>API: multer (memória): limite de tamanho + pré-filtro do MIME declarado
    API->>API: Detecta o tipo pelos magic bytes e exige que confira com o MIME declarado
    API->>Storage: Grava em /app/uploads com nome aleatório e extensão do tipo detectado
    API->>API: Calcula Status visual inicial (RN-001)
    API->>DB: Inicia transação: INSERT INTO documents & INSERT INTO audit_logs (Action: 'CREATE')
    alt Transação confirmada
        DB-->>API: Commit da transação
        API->>API: Efeitos externos pós-commit: sincronização Google Agenda (RN-007, não bloqueante)
        API-->>UI: Retorna 201 Created com objeto do documento
    else Falha na transação
        DB-->>API: Rollback automático
        API->>Storage: Remove novo arquivo recém-gravado em disco
        API-->>UI: Retorna erro 5xx
    end
    UI-->>User: Exibe toast de sucesso e atualiza tabela/dashboard em tempo real
```

### 6.1.1 Validação e Entrega de Anexos (DOC-34)

Implementação em `backend/src/services/storageService.ts` e `backend/src/app.ts`; vale para `POST /documents`, `PUT /documents/:id` e `POST /documents/:id/renew` (`upload.single('attachment')`).

1. **Recebimento**: o multer usa `memoryStorage` com o limite `MAX_FILE_SIZE_BYTES` (padrão 10 MB; excedido → `400 FILE_TOO_LARGE`). Nada é gravado em disco antes da validação, então um upload rejeitado não deixa arquivo no diretório de uploads.
2. **Pré-filtro**: o `Content-Type` declarado pelo cliente precisa ser `application/pdf`, `image/png`, `image/jpeg` ou `image/jpg` (alias de JPEG). Caso contrário → `400 INVALID_FILE_TYPE`.
3. **Detecção real (magic bytes)**: o servidor lê a assinatura do conteúdo — PDF `%PDF-` (`25 50 44 46 2D`), PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`. Arquivo vazio, conteúdo sem assinatura permitida ou tipo detectado diferente do declarado (ex.: PNG enviado como `image/jpeg`, HTML enviado como `application/pdf`) → `400 INVALID_FILE_TYPE`.
4. **Gravação**: o nome em disco é `<timestamp>-<hash aleatório><ext>`, com `ext` derivada **somente** do tipo detectado (`.pdf`, `.png`, `.jpg`). O `originalname` do cliente é guardado apenas como metadado (`attachment_filename`) e `file_mime_type` recebe o tipo detectado.
5. **Entrega** (`GET /api/v1/uploads/:arquivo`, autenticado): só extensões da allow-list (`.pdf`, `.png`, `.jpg` e `.jpeg` legado) são servidas — demais → `404`; diretórios e dotfiles não são servidos. Toda resposta traz `Content-Type` fixo pela extensão, `X-Content-Type-Options: nosniff` e `Content-Disposition: attachment; filename="<nome gerado>"`.
6. **Cabeçalhos globais**: `helmet()` em toda a API, com CSP restritiva (`default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox`) — a API só devolve JSON/arquivos; o SPA é servido pelo Nginx. `Cross-Origin-Resource-Policy` fica `same-origin`, pois o frontend acessa a API pelo mesmo origin (proxy do Vite/Nginx).
7. **Frontend**: a visualização/baixa usa `Blob` cujo tipo vem de uma allow-list (`application/pdf`, `image/png`, `image/jpeg`) aplicada ao `Content-Type` da resposta; qualquer outro tipo vira `application/octet-stream` (baixado, nunca renderizado no origin da aplicação).

### 6.2 Renovação de Documento com Histórico de Versão (RN-002 & RN-008)

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuário
    participant UI as Frontend React
    participant API as Backend Express API
    participant DB as PostgreSQL 16
    participant Storage as Storage de Anexos

    User->>UI: Clica em "Renovar" no documento
    UI->>User: Exibe modal de renovação (Novas datas de emissão/vencimento e novo anexo)
    User->>UI: Preenche novas datas + Anexa novo arquivo + Confirma
    UI->>API: POST /api/v1/documents/:id/renew (multipart/form-data)
    API->>Storage: Salva novo arquivo anexo
    loop Tentativas de concorrência (até 3x em caso de conflito P2002)
        API->>DB: Transação atômica (prisma.$transaction):
        Note over API,DB: 1. SELECT max(version_number) + 1 via aggregate\n2. INSERT INTO document_versions (unique document_id, version_number)\n3. UPDATE documents (novas datas, novo anexo, status recalculado)\n4. INSERT INTO audit_logs (Action: 'RENEW', diff_data completo)
        alt Sucesso
            DB-->>API: Commit da transação
        else Conflito de versão (P2002)
            DB-->>API: Rollback da transação (tenta novamente até 3 vezes)
        end
    end
    alt Transação confirmada com sucesso
        API-->>UI: Retorna documento atualizado com versão incrementada (200 OK)
    else Esgotou 3 tentativas por conflito (P2002)
        API->>Storage: Remove novo arquivo recém-gravado em disco (preserva anexo original)
        API-->>UI: Retorna 409 Conflict com mensagem explicativa em português
    else Falha inesperada
        API->>Storage: Remove novo arquivo recém-gravado em disco (preserva anexo original)
        API-->>UI: Retorna erro 5xx
    end
    UI-->>User: Atualiza visual com badge de versão e disponibiliza aba de histórico
```

### 6.3 Sincronização Real com Google Agenda via OAuth (RF-005 / RN-007 / ADR-009)

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuário (Admin / Operacional)
    participant UI as Frontend React (Configurações / Documentos)
    participant API as Backend Express API
    participant Google as Google OAuth2 & Calendar API
    participant DB as PostgreSQL 16

    Note over User,DB: Conexão da conta (uma vez por usuário)
    User->>UI: Clica "Conectar Google Agenda" em Configurações
    UI->>API: GET /calendar/google/connect (Bearer JWT)
    API-->>UI: { url } com state assinado (expira em 10 min)
    UI->>Google: window.location.href = url (navegação de página inteira)
    User->>Google: Autoriza o escopo calendar.events na tela de consentimento
    Google->>API: GET /calendar/google/callback?code&state (rota pública)
    API->>API: Verifica assinatura do state e troca code por access/refresh token
    API->>DB: Upsert em google_oauth_tokens (por user_id)
    API-->>UI: Redirect /configuracoes?google=connected

    Note over User,DB: Gatilho automático (RN-007)
    User->>UI: Cria, edita (vencimento), arquiva/desarquiva ou exclui um documento
    UI->>API: POST/PUT/PATCH/DELETE /api/v1/documents/...
    API->>DB: Persiste o documento e o audit_log da operação (fluxo normal)
    API->>API: Chama gcalService (create/update/delete) de forma não bloqueante
    API->>DB: Busca google_oauth_tokens pelo created_by_id do documento
    alt Usuário não conectou o Google Agenda
        API->>DB: INSERT gcal_sync_logs (status: ERROR, mensagem explicativa)
    else Conta conectada
        API->>DB: Busca o gcal_sync_logs mais recente com status SYNCED do documento
        alt Já existe gcalEventId registrado (edição/arquivamento/exclusão)
            API->>Google: calendar.events.update ou calendar.events.delete (mesmo eventId, agenda "primary")
        else Nenhum evento anterior (criação)
            API->>Google: calendar.events.insert (evento de dia inteiro na data de vencimento)
        end
        Google-->>API: Confirma e retorna o id real do evento (ou renova o access_token via refresh_token, se expirado)
        API->>DB: Atualiza access/refresh token renovados (se houve renovação) e grava gcal_sync_logs (SYNCED ou DELETED) com o gcal_event_id real
    end
    API-->>UI: Responde a operação no documento normalmente (falha de sync nunca bloqueia a resposta)
```

O evento nunca é duplicado entre edições: `gcalService.ts` sempre reutiliza o
mesmo `gcalEventId` já registrado em `gcal_sync_logs` para aquele documento,
optando por `update`/`delete` sobre ele em vez de criar um novo evento a cada
sincronização; um `insert` só ocorre quando o documento ainda não possui nenhum
log `SYNCED` anterior. Ver ADR-009 (`.aihaus/memory/project/decisions.md`)
para a decisão de modelo de conta (OAuth por usuário vs. conta de serviço
compartilhada) e suas consequências.

---

## 7. Decisões de Arquitetura Tecnológica (ADRs)

### ADR-001: Arquitetura Monorepo Modular Local-First
- **Decisão**: Adotar estrutura monorepo com pastas independentes `backend/` e `frontend/`, scripts cross-platform no `package.json` raiz e orquestração Docker Compose unificada.
- **Racional**: Permite que desenvolvedores e operadores executem o sistema completo com 1 único comando (`docker compose up --build`), garantindo ambiente isolado, paridade de desenvolvimento/produção e facilidade de testes E2E.

### ADR-002: Containerização Multi-Stage e Nginx SPA Proxy
- **Decisão**: O frontend é compilado via multi-stage build no Dockerfile e servido por container Nginx Alpine ultra-leve, que atua simultaneamente como servidor de estáticos (com SPA Fallback para `index.html`) e Reverse Proxy redirecionando chamadas `/api/v1/*` para o container do backend.
- **Racional**: Elimina problemas de CORS, unifica a porta de entrada da aplicação (`http://localhost:80` ou `3000`), reduz o tamanho final da imagem e protege os headers HTTP com gzip e security policies.

### ADR-003: Abstração de Armazenamento de Arquivos (`IStorageService`)
- **Decisão**: Implementar o armazenamento de arquivos anexos desacoplado através de uma interface de serviço (`IStorageService` e `LocalStorageService`).
- **Racional**: Garante custo zero no MVP armazenando arquivos no disco local montado em volume `/app/uploads`, permitindo migração futura imediata para Amazon S3 ou Supabase Storage apenas criando uma nova implementação da interface.

### ADR-004: Trilha de Auditoria com Diff Estruturado em JSON
- **Decisão**: Registrar todas as mutações na tabela `audit_logs` contendo autor, ação e um payload JSONB com o diff explícito (`old` vs `new`).
- **Racional**: Atende integralmente a regra RN-008 e viabiliza a renderização de componentes de comparação visual no frontend sem necessidade de recálculos complexos.

### ADR-005: Suíte de Testes Automatizados em Três Camadas
- **Decisão**: Estruturar a garantia de qualidade em 3 esteiras:
  1. **Testes Unitários / Integração Backend (Vitest)**: 140 casos cobrindo controllers, services, middlewares e regras de negócio.
  2. **Testes Unitários Frontend (Vitest + React Testing Library)**: 28 casos cobrindo autenticação, formulários, RBAC e modais.
  3. **Testes E2E HTTP Integrados (Vitest + Docker Runner)**: 19 casos cobrindo os cenários TC-01 a TC-08 contra containers reais em portas dinâmicas com teardown garantido.
- **Racional**: 100% de confiabilidade nas entregas, prevenindo regressões em upgrades e refatorações.

---

## 8. Status de Implementação e Verificação das Fases

Todas as 4 fases do projeto foram concluídas com sucesso:

| Fase | Descrição | Status | Evidência de Conclusão |
| :--- | :--- | :---: | :--- |
| **Fase 1** | Levantamento de Requisitos e PRD | ✅ Concluído | [PRD.md](./PRD.md) aprovado com matriz de regras de negócio. |
| **Fase 2** | Arquitetura e Modelagem de Dados | ✅ Concluído | [ARCHITECTURE.md](./ARCHITECTURE.md), Schema Prisma e ERD. |
| **Fase 3** | Implementação Full-Stack | ✅ Concluído | Backend REST API, Frontend SPA React, Design System Midnight Navy. |
| **Fase 4** | Dockerização, Scripts e Testes E2E | ✅ Concluído | Docker Compose unificado, scripts `run-e2e.mjs`, **187/187 testes passando**. |
