# Deployment

## Environments

- Verified: a única topologia de implantação descrita é o Docker Compose com `postgres`, `backend` e `frontend`; o frontend é buildado com `VITE_API_URL=/api/v1` e o Nginx faz proxy de `/api/v1/*` para o backend. Source: `docker-compose.yml` (reviewed 824aace).
- Unresolved: ambientes de homologação/produção, provedor e domínio não estão documentados no repositório.

## Preconditions

- Verified: o backend só inicia após o healthcheck do Postgres (`pg_isready`), e o frontend só após o healthcheck do backend (`/api/v1/health`). Source: `docker-compose.yml` (reviewed 824aace).
- Verified: fora de desenvolvimento, `JWT_SECRET` e as senhas de seed precisam ser definidas — o README alerta que as credenciais de demonstração são apenas locais. Source: `README.md` (reviewed 824aace).
- Verified: a sincronização com Google Agenda requer as variáveis `GOOGLE_*` e `FRONTEND_URL` corretas para o redirect do OAuth. Source: `docker-compose.yml` (reviewed 824aace).

## Release procedure

- Verified: migrações de produção usam `prisma migrate deploy` (`npm run db:deploy`), executado automaticamente pelo entrypoint do container do backend. Source: `backend/docker-entrypoint.sh` (reviewed 824aace).
- Unresolved: não há processo de release, versionamento de imagens ou CI/CD documentado.

## Smoke checks

- Verified: `GET /api/v1/health` no backend e `GET /health` no Nginx são os healthchecks usados pelo compose. Source: `docker-compose.yml` (reviewed 824aace).

## Rollback

- Unresolved: não há procedimento de rollback documentado; migrações Prisma não têm down-migrations no repositório.

## Approval policy

- Unresolved: nenhuma política de aprovação de deploy está registrada. Operações destrutivas (`docker:reset`, `db:reset`) apagam dados e não devem rodar sem confirmação do dono.

Instructions are not containment. Name the external controls and credential
scope required for each environment.
