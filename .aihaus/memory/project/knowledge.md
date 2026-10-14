# Knowledge

## Verified facts

- Verified: stack do backend — Node.js 20 (imagem `node:20-alpine`), Express 4, TypeScript, Prisma, Zod, JWT (`jsonwebtoken`), `bcryptjs`, Multer e `googleapis`. Source: `backend/package.json` (reviewed 824aace).
- Verified: stack do frontend — React 18, Vite, Tailwind, React Router, React Hook Form + Zod, Axios, Recharts, Lucide; servido por `nginx:1.27-alpine` em produção. Source: `frontend/package.json` (reviewed 824aace).
- Verified: todas as rotas da API têm prefixo `/api/v1`; healthcheck em `/api/v1/health`. Source: `docker-compose.yml` (reviewed 824aace).
- Verified: o status é calculado com datas normalizadas para meia-noite local; `EXPIRED` quando o vencimento é anterior a hoje, `CRITICAL` quando faltam `<= alertLeadDays` dias (padrão 30). Source: `backend/src/services/statusService.ts` (reviewed 824aace).
- Verified: uploads aceitam PDF, PNG e JPEG validando apenas o `mimetype` informado, com limite `MAX_FILE_SIZE`. Source: `backend/src/services/storageService.ts` (reviewed 824aace).
- Verified: `DELETE /documents/:id` exige `ADMIN`; criar/editar/renovar/arquivar exigem apenas autenticação. Source: `backend/src/routes/documentRoutes.ts` (reviewed 824aace).
- Verified: criar/editar/excluir categorias exige `ADMIN`; listar exige apenas autenticação. Source: `backend/src/routes/categoryRoutes.ts` (reviewed 824aace).
- Verified: o recálculo em lote e o digest diário são funções exportadas sem agendador; são acionados pelo controller de notificações. Source: `backend/src/controllers/notificationController.ts` (reviewed 824aace).

## Conflitos entre docs e código

- Unresolved: PRD/ARCHITECTURE afirmam recálculo diário automático às 00:00 via `cronService.ts`; não há `node-cron`, `setInterval` ou agendamento no backend. Source: `backend/src/services/cronService.ts` (reviewed 824aace).
- Unresolved: PRD afirma alertas por e-mail; `sendExpirationAlert`/`sendDailyDigest` apenas montam a mensagem e retornam sucesso, sem transporte. Source: `backend/src/services/notificationService.ts` (reviewed 824aace).
- Unresolved: PRD/ARCHITECTURE afirmam validação de magic bytes no upload; nenhuma verificação de assinatura de bytes existe no backend. Source: `backend/src/services/storageService.ts` (reviewed 824aace).
- Unresolved: README diz que `npm run test:unit` faz "checagem de tipos do frontend", mas o script roda `vitest run` no frontend (a checagem de tipos é `test:typecheck`). Source: `package.json` (reviewed 824aace).
- Unresolved: README instrui `cd implementer-antigravity` após clonar, nome de pasta que não corresponde ao repositório. Source: `README.md` (reviewed 824aace).

## Recurring gotchas

- Inferred candidate: o teste do `cronService` usa fixture com `expirationDate` fixa em `2026-08-30` sem `vi.setSystemTime`/fake timers, então o resultado esperado (`CRITICAL`) depende da data real e tende a falhar após essa data. Source: `backend/tests/notification-gcal.test.ts` (reviewed 824aace).
- Verified: não defina `Content-Type` fixo na instância compartilhada do Axios — isso faz o Axios serializar `FormData` como JSON e quebra uploads (bug DOC-29); a instância atual não define o header. Source: `frontend/src/services/api.ts` (reviewed 824aace).
- Verified: scripts shell devem usar LF; `.gitattributes` força `eol=lf` em `*.sh`. Source: `.gitattributes` (reviewed 824aace).

## Useful code analogs

- Verified: padrão de rota pública antes do `authMiddleware` no mesmo router (callback OAuth). Source: `backend/src/routes/calendarRoutes.ts` (reviewed 824aace).
- Verified: padrão de restrição por papel com `requireRole([Role.ADMIN])` por rota. Source: `backend/src/routes/categoryRoutes.ts` (reviewed 824aace).

Each entry should name its evidence and last review date. Transient research
belongs in the task that used it, not here.
