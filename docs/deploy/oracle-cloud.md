# Plano de implantação — Oracle Cloud Always Free (1 usuário)

> Linear: **DOC-46** · Tarefa: `.aihaus/memory/kanban/todo/T-261023-97bf04-doc-46-deploy-na-oracle-cloud-always-free.md`
> Status: **planejado, não implementado** (23/10/2026). Base: `main` após o PR #30.

## Objetivo

Hospedar o DocsObs sem custo para um único usuário, com HTTPS, banco e API sem
exposição pública, e-mails de alerta, sincronização com o Google Agenda e
backup diário. Sem alta disponibilidade.

## Arquitetura alvo

```text
Navegador ──HTTPS:443──▶ Caddy (TLS automático, Let's Encrypt)
                           │  docsobs.duckdns.org
                           ▼
                        frontend (Nginx :80) ── SPA + proxy /api/v1/* ──▶ backend (:3001) ──▶ postgres (:5432)
                                                                              │
                                                        volume backend_uploads ┘   volume postgres_data
```

- Só o Caddy publica portas no host (80 e 443). `frontend`, `backend` e
  `postgres` ficam só na rede interna `docsobs-network`.
- VM: Oracle **VM.Standard.A1.Flex (ARM64)**, Ubuntu 24.04, 2 OCPU / 12 GB
  (dentro do Always Free: até 4 OCPU / 24 GB e 200 GB de disco no total).
- Domínio gratuito: subdomínio do **DuckDNS** apontando para um **IP público
  reservado** da VM.
- O serviço opcional de OCR (`extraction`, perfil do compose) cabe na VM;
  ativar só se for usar o pré-preenchimento por leitura do anexo.

## Fase 0 — Pré-requisitos (contas, fora do repositório)

| Item | Ação | Observação |
|---|---|---|
| Oracle Cloud | Criar conta Free Tier (pede cartão só para verificação) e escolher a *home region* | Algumas regiões ficam sem capacidade ARM; se falhar, tentar outro AD/horário. |
| Ociosidade | Considerar converter a conta para **Pay As You Go** (continua grátis dentro dos limites Always Free) | Contas apenas Free podem ter instâncias ociosas recuperadas pela Oracle; app de 1 usuário é ocioso. **Confirmar a política vigente no console.** |
| DuckDNS | Criar subdomínio (ex.: `docsobs.duckdns.org`) | Gratuito; login com GitHub/Google. |
| E-mail (SMTP) | Senha de app do Gmail **ou** plano grátis Brevo/Resend | Sem SMTP os alertas de vencimento não saem (RN de alertas, DOC-31). |
| Google OAuth | Projeto no Google Cloud, tela de consentimento, cliente OAuth Web | Detalhes na Fase 5. |

## Fase 1 — Mudanças no repositório (implementar e revisar via PR)

| # | Arquivo | Conteúdo |
|---|---|---|
| 1 | `docker-compose.prod.yml` (novo) | Override para produção: remove as portas de host de `postgres`, `backend` e `frontend` (`ports: !reset []`, suportado pelo Compose ≥ 2.24); adiciona o serviço `caddy` (`caddy:2-alpine`, portas `80:80` e `443:443`, `restart: unless-stopped`, volumes `caddy_data` e `caddy_config`, montando `deploy/Caddyfile`), `depends_on: frontend (healthy)`. Fixar `FRONTEND_URL` e `GOOGLE_REDIRECT_URI` a partir de `DOMAIN`. |
| 2 | `deploy/Caddyfile` (novo) | `{$DOMAIN} { encode gzip; reverse_proxy frontend:80; header Strict-Transport-Security "max-age=31536000" }`. `client_max_body_size` do Nginx (≥ 12M) continua valendo atrás do Caddy. |
| 3 | `.env.production.example` (novo) | Todas as variáveis de produção comentadas (lista abaixo), sem valores reais. |
| 4 | `scripts/backup.sh` (novo) | `docker compose exec -T postgres pg_dump -U $POSTGRES_USER -Fc $POSTGRES_DB` + `tar` do volume `backend_uploads` para `/var/backups/docsobs/AAAA-MM-DD/`; mantém 7 dias; código de saída ≠ 0 em falha. Opcional: enviar para Oracle Object Storage (20 GB grátis) com `oci os object put` ou `rclone`. |
| 5 | `scripts/restore.sh` (novo) | Restaura um backup escolhido: para `backend`, `pg_restore --clean --if-exists`, repõe uploads, sobe de novo. Avisar que é destrutivo. |
| 6 | `README.md` | Seção "Produção (Oracle Cloud)" apontando para este plano e para o runbook. |
| 7 | `.aihaus/memory/project/procedures.md` e `deployment.md` | Runbook de deploy/atualização/backup/restauração e topologia real (o orquestrador promove ao concluir). |
| 8 | Validação ARM | Build das 3 imagens em `linux/arm64` (na própria VM ou `docker buildx build --platform linux/arm64`). O Prisma usa `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` e gera o client dentro da imagem, então deve resolver o engine ARM; **ainda não testado em ARM**. |

### Variáveis de produção (`.env` no servidor, nunca versionado)

| Variável | Valor |
|---|---|
| `DOMAIN` | `docsobs.duckdns.org` (novo, usado pelo Caddy e para montar as URLs) |
| `NODE_ENV` | `production` (já fixado no compose) |
| `APP_TIMEZONE` | `America/Sao_Paulo` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | usuário próprio + senha forte (o padrão atual é `postgres`/`postgres`) |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` (≥ 32, DOC-33) |
| `RUN_SEED` | `true` só na **primeira** subida; depois `false` |
| `ADMIN_SEED_PASSWORD` / `OPERATIONAL_SEED_PASSWORD` | ≥ 12 caracteres (DOC-32); trocar a senha no app após o 1º login |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` / `EMAIL_FROM` | do provedor escolhido |
| `CRON_ENABLED` | `true` (padrão); recálculo e digest às 00:00 em `APP_TIMEZONE` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | do cliente OAuth |
| `GOOGLE_REDIRECT_URI` | `https://<DOMAIN>/api/v1/calendar/google/callback` |
| `FRONTEND_URL` | `https://<DOMAIN>` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — **obrigatória após o DOC-44** (criptografia dos tokens OAuth) |
| `EXTRACTION_SERVICE_URL` | `http://extraction:8000` só se o perfil `extraction` for usado |

## Fase 2 — Provisionar a VM na Oracle

1. Criar a instância `VM.Standard.A1.Flex` (2 OCPU / 12 GB), imagem **Ubuntu 24.04 aarch64**, boot volume 50–100 GB, chave SSH própria.
2. **Reservar o IP público** (Networking → Reserved Public IPs) e associar à VNIC.
3. VCN → Security List: liberar entrada TCP **22** (só do seu IP), **80** e **443** (0.0.0.0/0).
4. **Firewall do Ubuntu da Oracle**: as imagens vêm com regras `iptables` que rejeitam tudo além do SSH. Liberar 80/443 antes da regra de REJECT e persistir:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
5. Atualizar e endurecer: `sudo apt update && sudo apt full-upgrade -y`, `unattended-upgrades`, SSH só por chave (`PasswordAuthentication no`).
6. Instalar Docker Engine + plugin Compose pelo repositório oficial da Docker (ARM64) e adicionar o usuário ao grupo `docker`.
7. Fuso da VM: `sudo timedatectl set-timezone America/Sao_Paulo` (o app usa `APP_TIMEZONE`; o fuso da VM só afeta o cron de backup e os logs).

## Fase 3 — DNS

1. No DuckDNS, apontar o subdomínio para o IP reservado.
2. Conferir com `nslookup docsobs.duckdns.org` antes de subir o Caddy (o Let's Encrypt precisa do DNS resolvido e da porta 80 aberta).

## Fase 4 — Primeiro deploy

```bash
git clone https://github.com/anmarfp/DocsObs.git && cd DocsObs
cp .env.production.example .env   # preencher conforme a tabela acima (RUN_SEED=true)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

Smoke checks:
- `curl -I https://<DOMAIN>/` → 200 com certificado válido.
- `curl https://<DOMAIN>/api/v1/health` → `{"status":"ok",...}`.
- `nc -zv <IP> 5432` e `nc -zv <IP> 3001` de fora → **recusado** (banco e API sem porta pública).
- Login como `admin@docsobs.com.br`, trocar a senha, cadastrar um documento com anexo, baixar o anexo.

Depois do 1º login: definir `RUN_SEED=false` no `.env` e repetir o `up -d` (o seed é idempotente, mas não deve ficar ligado).

## Fase 5 — Integrações

**Google Agenda (ADR-009, RN-007)**
1. Tela de consentimento: tipo *External*, escopo `.../auth/calendar.events`, seu e-mail como usuário de teste.
2. Cliente OAuth *Web application*: origem `https://<DOMAIN>`, redirect `https://<DOMAIN>/api/v1/calendar/google/callback`.
3. **Status de publicação:** em *Testing*, o Google expira o refresh token em ~7 dias e a agenda desconecta toda semana. Para uso pessoal, publicar como *In production* e aceitar a tela "app não verificado" (o limite de usuários de app não verificado não afeta 1 usuário). **Confirmar a política vigente no console do Google.**
4. No app: Configurações → Conectar Google Agenda; cadastrar um documento com vencimento e conferir o evento; renovar e conferir a nova data (DOC-42).

**E-mail**: preencher `SMTP_*`/`EMAIL_FROM`, forçar um documento em `CRITICAL` e conferir o alerta; o digest diário só sai com pendências (DOC-41).

## Fase 6 — Operação

| Rotina | Como |
|---|---|
| Backup diário | `crontab -e` → `30 2 * * * /home/ubuntu/DocsObs/scripts/backup.sh >> /var/log/docsobs-backup.log 2>&1` |
| Teste de restauração | Restaurar o backup mais recente numa cópia (projeto compose separado) **uma vez** antes de considerar pronto, e depois mensalmente |
| Atualização | `git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait` (migrations rodam no entrypoint) |
| Rollback | `git checkout <tag/commit anterior>` + `up -d --build`; como não há down-migrations, se a versão nova migrou o banco, restaurar o backup anterior |
| Logs | `docker compose ... logs -f backend` |
| Certificado | Renovado automaticamente pelo Caddy (volume `caddy_data` precisa persistir) |

Operações destrutivas (`docker compose down -v`, `restore.sh`, `db:reset`) apagam dados e exigem confirmação explícita do dono (`deployment.md`).

## Riscos e pontos em aberto

- **Recuperação de instância ociosa** pela Oracle em contas só Free — mitigação: Pay As You Go (sem custo dentro dos limites). Confirmar.
- **Capacidade ARM** indisponível na região — tentar outro AD/horário, ou usar `VM.Standard.E2.1.Micro` (AMD, 1 GB) com swap e sem OCR.
- **Build em ARM não testado** — primeira coisa a validar na VM (Fase 1, item 8).
- **Google em modo Testing** derruba a conexão a cada ~7 dias (Fase 5).
- **Ponto único de falha**: uma VM, sem réplica; aceitável para 1 usuário com backup fora da VM.
- `POSTGRES_PASSWORD` padrão `postgres` no compose atual — obrigatório trocar no `.env` de produção.

## Checklist de aceite (DOC-46)

- [ ] `https://<DOMAIN>` com certificado válido; 5432 e 3001 sem acesso externo
- [ ] Login, CRUD, upload/download de anexo, dashboard e calendário funcionando
- [ ] Alerta por e-mail recebido; Google Agenda conectado e evento sincronizado
- [ ] `backup.sh` agendado e uma restauração testada com sucesso
- [ ] Runbook promovido em `.aihaus/memory/project/procedures.md` e topologia em `deployment.md`
