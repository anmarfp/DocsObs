# Knowledge

## Verified facts

- Verified: stack do backend — Node.js 20 (imagem `node:20-alpine`), Express 4, TypeScript, Prisma, Zod, JWT (`jsonwebtoken`), `bcryptjs`, Multer e `googleapis`. Source: `backend/package.json` (reviewed 824aace).
- Verified: stack do frontend — React 18, Vite, Tailwind, React Router, React Hook Form + Zod, Axios, Recharts, Lucide; servido por `nginx:1.27-alpine` em produção. Source: `frontend/package.json` (reviewed 824aace).
- Verified: todas as rotas da API têm prefixo `/api/v1`; healthcheck em `/api/v1/health`. Source: `docker-compose.yml` (reviewed 824aace).
- Verified: o status é calculado com datas civis em meia-noite UTC (`getUTC*`) contra "hoje" no fuso `APP_TIMEZONE`; `EXPIRED` quando o vencimento é anterior a hoje, `CRITICAL` quando faltam `<= alertLeadDays` dias (padrão 30). Source: `backend/src/services/statusService.ts` (reviewed 60daa31).
- Verified: uploads aceitam PDF, PNG e JPEG validados por magic bytes (em memória, antes de gravar); a extensão gravada deriva do tipo detectado e `/api/v1/uploads` serve só a allow-list com `attachment` + `nosniff` (DOC-34). Source: `backend/src/services/storageService.ts` (reviewed 60daa31).
- Verified: `DELETE /documents/:id` exige `ADMIN`; criar/editar/renovar/arquivar exigem apenas autenticação. Source: `backend/src/routes/documentRoutes.ts` (reviewed 824aace).
- Verified: criar/editar/excluir categorias exige `ADMIN`; listar exige apenas autenticação. Source: `backend/src/routes/categoryRoutes.ts` (reviewed 824aace).
- Verified: variáveis de ambiente são lidas só em `backend/src/config/env.ts` (Zod, objeto congelado); em produção `JWT_SECRET` (>= 32) e `DATABASE_URL` são obrigatórios e o boot aborta com `exit 1` (DOC-33). Source: `backend/src/config/env.ts` (reviewed 60daa31).

## Conflitos entre docs e código

- Unresolved: README diz que `npm run test:unit` faz "checagem de tipos do frontend", mas o script roda `vitest run` no frontend (a checagem de tipos é `test:typecheck`). Source: `package.json` (reviewed 824aace).
- Unresolved: README instrui `cd implementer-antigravity` após clonar, nome de pasta que não corresponde ao repositório. Source: `README.md` (reviewed 824aace).

## Recurring gotchas

- Verified: testes que dependem de "hoje" devem congelar o relógio (`vi.useFakeTimers` + `vi.setSystemTime`) e não podem depender do fuso do host; rode a suíte com `TZ=America/Sao_Paulo` e `TZ=UTC` ao mexer em datas (DOC-27). Source: `backend/tests/status-timezone.test.ts` (reviewed 60daa31).
- Verified: ao excluir documento, `deleteDocumentEvent` deve rodar ANTES do hard delete: `gcal_sync_logs` cascateia e, depois do delete, o `gcalEventId` não é mais encontrado e o evento fica órfão no Google (regressão pega na revisão do DOC-37). Source: `backend/src/controllers/documentController.ts` (reviewed 60daa31).
- Verified: a renovação nunca apaga o anexo anterior — a versão arquivada em `document_versions` o referencia (RN-002). Source: `backend/src/controllers/documentController.ts` (reviewed 60daa31).
- Verified: testes que precisam variar env usam `vi.mock('../src/config/env.js')` com um dublê mutável, nunca mutação de `process.env` em runtime. Source: `backend/tests/google-auth.test.ts` (reviewed 60daa31).
- Verified: não defina `Content-Type` fixo na instância compartilhada do Axios — isso faz o Axios serializar `FormData` como JSON e quebra uploads (bug DOC-29); a instância atual não define o header. Source: `frontend/src/services/api.ts` (reviewed 824aace).
- Verified: scripts shell devem usar LF; `.gitattributes` força `eol=lf` em `*.sh`. Source: `.gitattributes` (reviewed 824aace).
- Verified: `prisma` e `@prisma/client` estão fixados em `~6.12.0` de propósito: as versões 6.13 a 7.10 puxam `deepmerge-ts` vulnerável (GHSA-ggr8-5vv4-36mx) via `@prisma/config`, e a correção só existe na 7.10.1+/8.x (major). Não suba para 6.13+ sem migrar de major (DOC-38). Source: `backend/package.json` (reviewed 6a7514a).
- Verified: na imagem de produção o CLI do Prisma é instalado global (`npm install -g prisma@<versão de devDependencies.prisma>`) depois de `npm ci --omit=dev --omit=optional`; `npm install <pkg>` local sem `--omit=dev` reifica todas as devDependencies na imagem, e com `--omit=dev` ignora o próprio `prisma` por ser devDependency. O `npx prisma migrate deploy` do entrypoint resolve o CLI global sem rede (DOC-38). Source: `backend/Dockerfile` (reviewed 6a7514a).

## Useful code analogs

- Verified: padrão de rota pública antes do `authMiddleware` no mesmo router (callback OAuth). Source: `backend/src/routes/calendarRoutes.ts` (reviewed 824aace).
- Verified: padrão de restrição por papel com `requireRole([Role.ADMIN])` por rota. Source: `backend/src/routes/categoryRoutes.ts` (reviewed 824aace).

Each entry should name its evidence and last review date. Transient research
belongs in the task that used it, not here.
