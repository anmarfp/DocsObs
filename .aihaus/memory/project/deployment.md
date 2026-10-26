# Deployment

## Environments

- Verified: a única topologia de implantação descrita é o Docker Compose com `postgres`, `backend` e `frontend`; o frontend é buildado com `VITE_API_URL=/api/v1` e o Nginx faz proxy de `/api/v1/*` para o backend. Source: `docker-compose.yml` (reviewed 824aace).
- Unresolved: ambientes de homologação/produção, provedor e domínio não estão documentados no repositório.
- Verified: os artefatos de produção do DOC-46 (fase 1) existem e foram validados localmente em amd64 e arm64 (QEMU): override com Caddy/HTTPS, banco e API sem porta de host, backup e restauração. Source: `docker-compose.prod.yml`, `scripts/backup.sh`, `scripts/restore.sh` (reviewed 7709382).
- Unresolved: a implantação em si (Oracle Cloud Always Free, VM ARM A1.Flex, Ubuntu 24.04, subdomínio DuckDNS, SMTP e Google OAuth) ainda não foi feita; segue na tarefa-mãe `T-261023-97bf04` (DOC-46, fases 0 e 2-6). Source: `docs/deploy/oracle-cloud.md` (reviewed 7709382).

## Preconditions

- Verified: o backend só inicia após o healthcheck do Postgres (`pg_isready`), e o frontend só após o healthcheck do backend (`/api/v1/health`). Source: `docker-compose.yml` (reviewed 824aace).
- Verified: fora de desenvolvimento, `JWT_SECRET` e as senhas de seed precisam ser definidas — o README alerta que as credenciais de demonstração são apenas locais. Source: `README.md` (reviewed 824aace).
- Verified: a sincronização com Google Agenda requer as variáveis `GOOGLE_*` e `FRONTEND_URL` corretas para o redirect do OAuth. Source: `docker-compose.yml` (reviewed 824aace).
- Verified: com o Google configurado em produção, `GOOGLE_TOKEN_ENCRYPTION_KEY` precisa estar definida e estável entre deploys; perdê-la ou trocá-la obriga todos os usuários a reconectar a agenda (DOC-44). Source: `backend/src/config/env.ts` (reviewed 597c468).

## Release procedure

- Verified: migrações de produção usam `prisma migrate deploy` (`npm run db:deploy`), executado automaticamente pelo entrypoint do container do backend. Source: `backend/docker-entrypoint.sh` (reviewed 824aace).
- Unresolved: não há processo de release, versionamento de imagens ou CI/CD documentado.

## Smoke checks

- Verified: `GET /api/v1/health` no backend e `GET /health` no Nginx são os healthchecks usados pelo compose. Source: `docker-compose.yml` (reviewed 824aace).
- Verified: smoke de produção — `https://<DOMAIN>/` e `https://<DOMAIN>/api/v1/health` com 200 via Caddy, `http://` redireciona (308) para `https://`, e 5432/3001/3000 recusam conexão de fora. Source: `docs/deploy/oracle-cloud.md` (reviewed 7709382).

## Rollback

- Verified: rollback = `git checkout <tag/commit anterior>` + `up -d --build --wait`; como as migrations Prisma não têm down, se a versão nova migrou o banco, restaurar o backup anterior com `scripts/restore.sh` (o banco restaurado não guarda tabelas de migrations mais novas). Source: `docs/deploy/oracle-cloud.md`, `scripts/restore.sh` (reviewed 7709382).

## Approval policy

- Unresolved: nenhuma política de aprovação de deploy está registrada. Operações destrutivas (`docker:reset`, `db:reset`) apagam dados e não devem rodar sem confirmação do dono.

Instructions are not containment. Name the external controls and credential
scope required for each environment.
