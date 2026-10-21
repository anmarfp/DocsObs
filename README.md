# DocsObs — Sistema de Gestão de Vencimento de Documentos

> Plataforma web para controle, acompanhamento e renovação de documentos corporativos com Matriz Visual de Cores, alertas de prazos críticos, sincronização com calendário e trilha de auditoria imutável (RN-008).

---

## 📑 Sumário

- [Arquitetura do Sistema](#-arquitetura-do-sistema)
- [Stack Tecnológica](#-stack-tecnológica)
- [Início Rápido com Docker (Recomendado)](#-início-rápido-com-docker-recomendado)
- [Início Rápido Local (Desenvolvimento)](#-início-rápido-local-desenvolvimento)
- [Usuários Iniciais (Seed)](#-usuários-iniciais-seed)
- [Comandos e Scripts Disponíveis](#-comandos-e-scripts-disponíveis)
- [Matriz de Rotas e Endpoints da API](#-matriz-de-rotas-e-endpoints-da-api)
- [Testes Automatizados e E2E](#-testes-automatizados-e-e2e)
- [Troubleshooting & Dúvidas Frequentes](#-troubleshooting--dúvidas-frequentes)

---

## 🏛️ Arquitetura do Sistema

O DocsObs é estruturado como um monorepo modular composto por frontend SPA em React e backend API RESTful em Node.js com persistência no PostgreSQL:

```mermaid
flowchart TD
    subgraph Client ["Navegador / Cliente"]
        Browser["Usuário (Browser Web)"]
    end

    subgraph Docker ["Ambiente Containerizado (Docker Compose)"]
        subgraph FrontendContainer ["Container: docsobs_frontend (:3000)"]
            Nginx["Nginx Alpine (Porta 80)"]
            SPA["React 18 SPA (Vite / Tailwind)"]
        end

        subgraph BackendContainer ["Container: docsobs_backend (:3001)"]
            Express["Express 4 REST API"]
            Prisma["Prisma ORM 6"]
            Uploads["Volume /app/uploads"]
        end

        subgraph DBContainer ["Container: docsobs_db (:5432)"]
            PostgreSQL["PostgreSQL 16"]
            PGData["Volume postgres_data"]
        end
    end

    Browser -->|HTTP :3000| Nginx
    Nginx -->|Serve SPA| SPA
    Nginx -->|Proxy /api/v1/*| Express
    Express -->|Prisma Client| PostgreSQL
    Express -->|Armazenamento de Anexos| Uploads
    PostgreSQL -->|Persistência| PGData
```

---

## 🛠️ Stack Tecnológica

| Camada | Tecnologias Principais |
| :--- | :--- |
| **Frontend** | React 18, TypeScript (estrito), Vite, Tailwind CSS (Tema Midnight Navy), Recharts, Lucide Icons, React Hook Form + Zod, Axios |
| **Backend** | Node.js 20, Express 4, TypeScript 5, Prisma ORM 6, Zod, JWT, BCrypt, Multer |
| **Banco de Dados** | PostgreSQL 16 Alpine |
| **Infraestrutura** | Docker, Docker Compose, Nginx Alpine (Reverse Proxy + SPA Fallback) |
| **Testes** | Vitest, Supertest (Testes unitários, integração e E2E) |

---

## 🐳 Início Rápido com Docker (Recomendado)

O provisionamento completo com banco de dados PostgreSQL, backend com migrações automáticas e frontend servido por Nginx pode ser realizado em um único comando (o seed é opcional e fica desabilitado por padrão — veja [Usuários Iniciais (Seed)](#-usuários-iniciais-seed)):

> ⚠️ **Importante:** A variável de ambiente `JWT_SECRET` (mínimo de 32 caracteres) é obrigatória para `docker compose up`. Configure-a no arquivo `.env` (copiando `.env.example`) antes de iniciar os serviços.

### 1. Clonar o repositório e subir os serviços:

```bash
git clone <url-do-repositorio>
cd implementer-antigravity

# Copie as variáveis e defina JWT_SECRET (mínimo de 32 caracteres)
cp .env.example .env

# Constrói as imagens e inicia os containers em segundo plano
docker compose up -d --build
```

### 2. Acessar a aplicação:

- 🌐 **Frontend (Aplicação Web):** [http://localhost:3000](http://localhost:3000)
- 🔌 **Backend API:** [http://localhost:3001/api/v1/health](http://localhost:3001/api/v1/health)
- 🗄️ **PostgreSQL:** `localhost:5432` (Usuário: `postgres`, Senha: `postgres`, Banco: `docsobs`)

### 3. Serviço de Extração por OCR (perfil opcional):

Para inicializar a aplicação com o serviço de extração automática de dados dos documentos (PDF, PNG, JPEG):

```bash
docker compose --profile extraction up -d --build
```

O serviço Python sobe em container isolado sob demanda (`EXTRACTION_SERVICE_URL=http://extraction:8000`), preenchendo sugestões no cadastro de documentos. Sem o perfil, o DocsObs sobe como de costume e o preenchimento manual continua funcionando normalmente.

---

## 💻 Início Rápido Local (Desenvolvimento)

Para desenvolver localmente com hot-reload no backend e frontend:

### 1. Instalar dependências da raiz e dos módulos:

```bash
npm install
```

### 2. Configurar variáveis de ambiente:

- **Linux / macOS (Bash):**
  ```bash
  cp .env.example backend/.env
  ```
- **Windows (PowerShell):**
  ```powershell
  Copy-Item .env.example backend/.env
  ```
- **Windows (CMD):**
  ```cmd
  copy .env.example backend\.env
  ```

### 3. Iniciar o PostgreSQL via Docker:

```bash
docker compose up -d postgres
```

### 4. Executar migrações e seed do banco de dados:

```bash
npm run db:migrate
npm run db:seed
```

### 5. Iniciar Backend e Frontend concorrentemente:

```bash
npm run dev:all
```
- Backend disponível em: `http://localhost:3001`
- Frontend disponível em: `http://localhost:5173`

---

## 🔑 Usuários Iniciais (Seed)

O seed cria dois perfis fixos de usuário:

| Perfil | E-mail de Acesso | Senha | Permissões (RBAC) |
| :--- | :--- | :--- | :--- |
| **Administrador** | `admin@docsobs.com.br` | `ADMIN_SEED_PASSWORD` | Acesso total: Painel, Documentos, Calendário, Auditoria, Gestão de Usuários e Configurações |
| **Operacional** | `operacional@docsobs.com.br` | `OPERATIONAL_SEED_PASSWORD` | Operações diárias: Painel, Cadastro de Documentos, Renovação e Calendário |

Não existem senhas padrão. O comportamento do seed depende do ambiente:

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `RUN_SEED` | `false` | Quando `true`, o container do backend executa o seed após as migrações. Com o padrão, `docker compose up` não cria nenhum usuário. |
| `ADMIN_SEED_PASSWORD` | — | Senha do Administrador. **Obrigatória em produção** (mín. 12 caracteres). |
| `OPERATIONAL_SEED_PASSWORD` | — | Senha do Operacional. **Obrigatória em produção** (mín. 12 caracteres). |
| `DEMO_SEED_PASSWORD` | — | Senha comum dos usuários de demonstração (somente fora de produção). |

- **Produção (`NODE_ENV=production`, como no `docker-compose.yml`):** sem `ADMIN_SEED_PASSWORD` e `OPERATIONAL_SEED_PASSWORD` válidas o seed termina com erro e o container não sobe. Usuários e documentos de demonstração **não** são criados.
- **Desenvolvimento (`npm run db:seed`):** variáveis vazias fazem o seed gerar uma senha aleatória por usuário, exibida **uma única vez** no console. Também são criados usuários e documentos de demonstração.
- O seed é idempotente: usuários já existentes não são recriados e suas senhas não são alteradas.

Exemplo para semear o primeiro acesso via Docker:

```bash
RUN_SEED=true ADMIN_SEED_PASSWORD='<senha-forte>' OPERATIONAL_SEED_PASSWORD='<senha-forte>' docker compose up -d --build
```

> ⚠️ **Aviso de Segurança:** Após o primeiro acesso, volte a usar `RUN_SEED=false` e troque as senhas pela aplicação. Em ambientes de produção altere também a chave `JWT_SECRET`.

---

## 📋 Comandos e Scripts Disponíveis

Todos os comandos podem ser executados a partir da raiz do repositório:

| Comando | Descrição |
| :--- | :--- |
| `npm run dev:all` | Inicia backend (3001) e frontend (5173) concorrentemente com hot-reload |
| `npm run build:all` | Compila o backend (TypeScript) e o frontend (Vite) para produção |
| `npm run test:unit` | Executa a suíte de testes unitários do backend e validação de tipos do frontend |
| `npm run test:e2e` | Executa a suíte de testes E2E / integração HTTP contra os endpoints reais |
| `npm run test:all` | Executa todos os testes da aplicação |
| `npm run db:migrate` | Aplica migrações Prisma pendentes no banco |
| `npm run db:deploy` | Aplica migrações em produção sem criar novos arquivos |
| `npm run db:seed` | Executa o seed de dados iniciais (usuários e categorias) |
| `npm run db:reset` | **Destrutivo:** Reseta o banco de dados e reaplica migrações |
| `npm run docker:up` | Constrói imagens e inicia todos os containers do Docker Compose |
| `npm run docker:down` | Para e remove os containers (mantém volumes de dados) |
| `npm run docker:reset` | **Destrutivo:** Destrói volumes (`-v`), reconstrói imagens e reinicia |
| `npm run docker:logs` | Visualiza logs consolidados de todos os serviços Docker em tempo real |
| `npm run clean` | Limpa pastas `dist/` e arquivos temporários |

---

## 🌐 Matriz de Rotas e Endpoints da API

Todas as rotas da API são prefixadas com `/api/v1`:

### Autenticação & Perfil
- `POST /api/v1/auth/login` — Autenticação de usuário e emissão de token JWT
- `GET /api/v1/auth/me` — Consulta dados do usuário autenticado

### Documentos & Renovação
- `GET /api/v1/documents` — Listagem paginada com filtros (status, categoria, busca, arquivados)
- `POST /api/v1/documents` — Cadastro de documento com upload de anexo multipart
- `GET /api/v1/documents/:id` — Detalhes do documento com histórico de versões e auditoria
- `PUT /api/v1/documents/:id` — Edição de dados do documento
- `POST /api/v1/documents/:id/renew` — Renovação com arquivamento da versão anterior (RN-002)
- `PATCH /api/v1/documents/:id/archive` — Alternar arquivamento manual (Admin only)
- `DELETE /api/v1/documents/:id` — Exclusão permanente de documento (Admin only)
- `GET /api/v1/documents/:id/attachment` — Download do arquivo anexo autenticado

### Categorias de Documentos
- `GET /api/v1/categories` — Listagem de categorias
- `POST /api/v1/categories` — Criação de nova categoria (Admin only)
- `DELETE /api/v1/categories/:id` — Exclusão de categoria sem vínculos (Admin only)

### Painel & Relatórios
- `GET /api/v1/dashboard/metrics` — Métricas consolidadas de status, conformidade e vencimentos
- `GET /api/v1/reports/summary` — Resumo executivo com filtros de período e status
- `GET /api/v1/reports/export` — Exportação de relatórios em formato CSV (com UTF-8 BOM) ou JSON

### Calendário & Sincronização
- `GET /api/v1/calendar/events` — Prazos e eventos filtrados por mês e ano
- `POST /api/v1/calendar/sync` — Sincronização manual com Google Agenda (OAuth por usuário)
- `GET /api/v1/calendar/sync-logs` — Logs de sincronização da agenda (Admin only)

### Trilha de Auditoria & Administração (Admin Exclusivo)
- `GET /api/v1/audit-logs` — Listagem paginada de logs de auditoria com diffs
- `GET /api/v1/audit-logs/:id` — Detalhe individual de um registro de auditoria
- `GET /api/v1/users` — Listagem de usuários
- `POST /api/v1/users` — Cadastro de novo usuário
- `PUT /api/v1/users/:id` — Atualização de cadastro de usuário
- `PATCH /api/v1/users/:id/status` — Ativação/inativação de usuário (protege contra auto-inativação)
- `PATCH /api/v1/users/:id/password` — Redefinição de senha de usuário
- `GET /api/v1/company/config` — Consulta política de notificação (RN-004)
- `PUT /api/v1/company/config` — Alteração do modo de notificação da empresa
- `POST /api/v1/notifications/recalculate` — Recálculo manual de status e envio de alertas
- `POST /api/v1/notifications/digest` — Disparo manual do Daily Digest consolidado

---

## 🧪 Testes Automatizados e E2E

O projeto possui cobertura de testes automatizados com Vitest:

```bash
# Executar todos os testes unitários do backend e checagem de tipos do frontend:
npm run test:unit

# Executar a suíte de testes de integração E2E (a stack isolada roda o seed em
# produção; o runner gera as senhas automaticamente quando não definidas):
ADMIN_SEED_PASSWORD='<senha-forte>' OPERATIONAL_SEED_PASSWORD='<senha-forte>' npm run test:e2e
```

---

## 🔧 Troubleshooting & Dúvidas Frequentes

### 1. Conflito de portas no host (`3000`, `3001` ou `5432`)
Se alguma porta já estiver em uso por outro serviço, você pode alterar as portas no arquivo `.env` ou passar variáveis na chamada do Docker Compose:
```bash
FRONTEND_PORT=3100 BACKEND_PORT=3101 POSTGRES_PORT=5433 docker compose up -d --build
```

### 2. Quebras de linha CRLF no Windows
Todos os scripts shell possuem normalização automática no Dockerfile e estão configurados com LF no arquivo `.gitattributes`. Caso edite scripts shell localmente no Windows, certifique-se de salvar em formato LF.

### 3. Limpeza total de containers e volumes
Para recriar todo o ambiente do zero (apagando dados do banco e uploads):
```bash
npm run docker:reset
```
