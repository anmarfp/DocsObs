# DOC-36 - Índices do banco (medição)

Migration: `backend/prisma/migrations/20261014144718_add_indexes`.

## O que foi criado

| Tabela | Índice | Atende |
| --- | --- | --- |
| documents | `category_id`, `created_by_id` | FKs |
| documents | `(is_archived, status)` | `groupBy status` e contagens do dashboard, cron (`status IN ...`) |
| documents | `expiration_date` | dashboard (próximos 30 dias), calendário (mês/ano), `ORDER BY expiration_date` |
| documents | `created_at` | `ORDER BY created_at DESC` da listagem |
| documents | GIN trigram `(title, issuing_body, responsible_name, notes)` | busca `contains`/`insensitive` (ILIKE `%x%`) da listagem |
| document_versions | `document_id`, `renewed_by_id` | FKs, contagem/listagem de versões, cascade |
| audit_logs | `timestamp` | página de auditoria `ORDER BY timestamp DESC LIMIT n` |
| audit_logs | `(document_id, timestamp)` | histórico por documento; cobre a FK (prefixo) |
| audit_logs | `user_id` | FK (`SET NULL` ao remover usuário), filtro por usuário |
| gcal_sync_logs | `(document_id, last_synced_at)` | `findCurrentGcalEventId`; cobre a FK (prefixo) |
| company_config | `updated_by_id` | FK |

`google_oauth_tokens.user_id` já tem UNIQUE e não recebeu índice extra.

O trigram é **multicoluna** porque a listagem busca com `OR` em quatro colunas:
um índice só em `title` não é usado (os outros ramos do `OR` forçam seq scan;
medido: 67 ms, Seq Scan). Com o índice multicoluna o planner faz `BitmapOr`
sobre os quatro ramos. Termos com menos de 3 caracteres não geram trigramas e
continuam em seq scan (comportamento esperado do pg_trgm).

A extensão `pg_trgm` é criada em SQL bruto na migration (`CREATE EXTENSION IF
NOT EXISTS`). O `schema.prisma` não usa a preview `postgresqlExtensions`, então
o Prisma não gerencia a extensão. `prisma migrate diff --from-migrations ...
--to-schema-datamodel ...` não detecta diferença.

## Medição

PostgreSQL 16-alpine descartável. Massa: 10k documentos (10% arquivados), 30k
versões, 200k audit logs, 50k gcal logs. SQL igual ao emitido pelo Prisma 6.19
(capturado com log de query). `EXPLAIN (ANALYZE, BUFFERS)` com cache quente;
mediana de 3 execuções, em ms.

| Consulta | Antes (plano / ms) | Depois (plano / ms) |
| --- | --- | --- |
| Dashboard `groupBy status` (`is_archived=false`) | Seq Scan / 9.7 | Index Only Scan `(is_archived,status)` / 1.9 |
| Dashboard contagem arquivados | Seq Scan / 1.6 | Index Only Scan / 0.23 |
| Dashboard próximos 30 dias | Seq Scan / 3.3 | Bitmap Index Scan `expiration_date` / 0.45 |
| Calendário mês (out/2026) | Seq Scan / 1.9 | Bitmap Index Scan `expiration_date` / 0.42 |
| Auditoria `ORDER BY timestamp DESC LIMIT 20` | Parallel Seq Scan + top-N sort / 51.7 | Index Scan Backward `timestamp` / 0.065 |
| Auditoria filtrada por documento | Parallel Seq Scan / 28.1 | Bitmap Index Scan `(document_id,timestamp)` / 0.15 |
| `findCurrentGcalEventId` | Seq Scan / 24.7 | Index Scan Backward `(document_id,last_synced_at)` / 0.044 |
| Versões por documento | Seq Scan / 3.4 | Bitmap Index Scan `document_id` / 0.12 |
| Busca só em `title` (ILIKE) | Seq Scan / 19.2 | Bitmap Index Scan trigram / 0.76 |
| Busca real da listagem (OR de 4 ILIKE) | Seq Scan / 62.4 | BitmapOr trigram / 0.69 |
| `DELETE` de um documento (triggers de FK) | 77.0 (seq scan por FK) | 9.8 |
| Listagem padrão (sem busca) | Seq Scan + Hash Join / 321 | sem mudança relevante / 338 |

A listagem padrão não melhora: ela não tem `LIMIT` e o `_count` de `auditLogs`
agrega a tabela `audit_logs` inteira em cada chamada. Isso exige paginação ou
outra forma de contagem (fora do escopo do DOC-36).

## Segurança da migration

- Só `CREATE INDEX` e `CREATE EXTENSION`. Nenhum dado é alterado.
- Para reverter: `DROP INDEX` de cada índice e, se nada mais depender dela,
  `DROP EXTENSION pg_trgm`.
- O Prisma executa cada migration em uma transação, então `CONCURRENTLY` não é
  possível. Cada `CREATE INDEX` bloqueia escritas (leituras continuam) na tabela
  enquanto o índice é construído. Na massa acima, os 13 índices levaram 4.3 s no
  total. O volume real é menor, então o custo foi aceito. Para bases grandes,
  aplicar os índices antes com `CREATE INDEX CONCURRENTLY` fora do Prisma e
  marcar a migration com `prisma migrate resolve --applied`.
- `pg_trgm` é extensão "trusted" desde o PG 13: o dono do banco consegue criá-la
  sem superuser.
- Custo de escrita: são 13 índices a mais, sendo que `audit_logs` passa a manter 3.
  O GIN trigram ocupa cerca de 2 MB para 10k documentos.
