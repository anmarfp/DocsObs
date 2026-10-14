# Environment

## Local

- Verified: desenvolvimento local usa PostgreSQL via `docker compose up -d postgres`, migrações/seed com `npm run db:migrate` e `npm run db:seed`, e `npm run dev:all` (backend em 3001 com `tsx watch`, frontend Vite em 5173). Source: `README.md` (reviewed 824aace).
- Verified: o arquivo de variáveis de exemplo da raiz é copiado para `backend/.env` no setup local; os arquivos `.env*` não foram lidos nesta revisão (caminhos sensíveis). Source: `README.md` (reviewed 824aace).
- Verified: o stack completo em containers tem três serviços na rede `docsobs-network` — `postgres` (postgres:16-alpine, porta host `POSTGRES_PORT`, padrão 5432), `backend` (porta host `BACKEND_PORT`, padrão 3001) e `frontend` (Nginx, porta host `FRONTEND_PORT`, padrão 3000) — com volumes `postgres_data` e `backend_uploads`. Source: `docker-compose.yml` (reviewed 824aace).
- Verified: o backend recebe `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `UPLOAD_DIR`, `MAX_FILE_SIZE_BYTES` (10485760), `RUN_SEED`, senhas de seed, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` e `FRONTEND_URL` por variáveis de ambiente; os valores padrão do compose são apenas para desenvolvimento. Source: `docker-compose.yml` (reviewed 824aace).

## CI

- Verified: não existe pipeline de CI no repositório (sem `.github/workflows/`); a verificação é local via `npm run test:all`. Source: `package.json` (reviewed 824aace).

## Staging or homolog

- Unresolved: nenhum ambiente de homologação está descrito no repositório.

## Production

- Unresolved: PRD diz "Em Produção", mas nenhum provedor de hospedagem, domínio ou topologia de produção está documentado no repositório. Source: `docs/PRD.md` (reviewed 824aace).

## External dependencies

- Verified: Google OAuth2 + Google Calendar API (escopo `calendar.events`), configurados por `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI`; sem eles a conexão de agenda fica indisponível. Source: `docker-compose.yml` (reviewed 824aace).
- Verified: o rastreamento de tarefas usa Linear (time `DOC`) operado pela CLI do Orca. Source: `.claude/skills/orca-linear/SKILL.md` (reviewed 824aace).

Describe topology and access expectations. Never store credentials or secret
values in this file.
