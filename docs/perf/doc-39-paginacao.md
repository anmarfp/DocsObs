# DOC-39 - Paginação e payload enxuto na listagem de documentos (medição)

Endpoint: `GET /api/v1/documents` (`backend/src/controllers/documentController.ts` — `listDocuments`).

## Causa raiz e alteração

Antes do DOC-39, `listDocuments` executava `prisma.document.findMany` sem `take`/`skip`, com `include.versions` e `_count: { select: { versions: true, auditLogs: true } }`:

1. O `_count` gerava dois `LEFT JOIN` com `GROUP BY` sobre as tabelas inteiras `document_versions` (`Seq Scan` + `HashAggregate` em 30k linhas) e `audit_logs` (`Seq Scan` + `HashAggregate` em 200k linhas).
2. A ausência de `LIMIT` impedia o uso do índice `documents_created_at_idx` para leitura top-N e forçava `Seq Scan` em `documents` seguido de `Sort (quicksort)` sobre todos os 9k documentos ativos.
3. O `include.versions` disparava uma consulta adicional `SELECT ... FROM document_versions WHERE document_id IN ($1, ..., $9000)` trazendo todas as versões históricas de todos os documentos listados, embora nenhum consumidor da listagem utilizasse `versions` nem `_count`.

Com o DOC-39:

- `listDocuments` valida `page` (inteiro `>= 1`, padrão `1`) e `limit` (inteiro `1..100`, padrão `20`) com retorno `400 VALIDATION_ERROR` para valores inválidos, aplica `skip = (page - 1) * limit` e `take = limit`, e retorna `{ documents, total, page, limit }`.
- `include.versions` e `_count` foram removidos da listagem (mantendo `category` e `createdBy`). `getDocumentById` permanece completo.

## Método de medição

Mesmo método de `docs/perf/doc-36-indices.md`:

- Container descartável PostgreSQL 16 (`docker run --rm -d --name doc39-pg -p 55433:5432 -e POSTGRES_PASSWORD=x postgres:16-alpine`) com todas as migrations aplicadas via `prisma migrate deploy` (e removido ao final com `docker rm -f doc39-pg`).
- Massa semeada via `generate_series` seguida de `ANALYZE`:
  - `10.000` documentos em `documents` (`9.000` ativos com `is_archived = false`, `1.000` arquivados — 10%), distribuídos entre 5 categorias e 5 status.
  - `30.000` versões em `document_versions` (3 por documento).
  - `200.000` registros em `audit_logs` (20 por documento).
- SQL capturado diretamente do log de eventos de query do Prisma 6.19.3 e medido com `EXPLAIN (ANALYZE, BUFFERS)` em cache quente (3 execuções após aquecimento; mediana destacada).

## Resultados (`EXPLAIN (ANALYZE, BUFFERS)`)

| Consulta | Antes (plano / mediana em ms) | Depois (plano / mediana em ms) |
| --- | --- | --- |
| `findMany` listagem padrão (`is_archived = false`, `ORDER BY created_at DESC`) | `Sort` + 2x `Hash Left Join` (`Seq Scan` em `documents`, `document_versions` e `audit_logs`, `shared hit=6836`) / **408,66 ms** (execuções: 486,06 / 408,66 / 387,14 ms) | `Limit` + `Index Scan Backward using documents_created_at_idx` (`shared hit=3`) / **0,084 ms** (execuções: 0,216 / 0,084 / 0,069 ms) |
| `count` total da listagem (`is_archived = false`) | `Aggregate` + `Index Only Scan using documents_is_archived_status_idx` (`Heap Fetches: 0`, `shared hit=11`) / **1,73 ms** | `Aggregate` + `Index Only Scan using documents_is_archived_status_idx` (`Heap Fetches: 0`, `shared hit=11`) / **1,73 ms** (execuções: 1,992 / 1,729 / 1,724 ms) |
| Query secundária `include.versions` (`WHERE document_id IN (...)`) | `464 ms` (9.000 IDs / 27.000 versões transferidas) | **Eliminada** |
| `Promise.all([findMany, count])` ponta a ponta no Prisma | **3.705,37 ms** (execuções: 3.705,37 / 4.343,29 / 3.442,39 ms) | **6,61 ms** (execuções: 35,63 / 6,61 / 5,98 ms) |

Ambas as métricas (`0,084 ms` na query principal `findMany` + `1,729 ms` no `count`, e `6,61 ms` ponta a ponta no Prisma) atendem com folga à meta `< 200 ms` do RNF-002.

## Planos capturados

### Antes (`findMany` principal sem `LIMIT` e com `_count`)

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT "public"."documents"."id", "public"."documents"."title", "public"."documents"."category_id", "public"."documents"."issuing_body", "public"."documents"."issue_date", "public"."documents"."expiration_date", "public"."documents"."alert_lead_days", "public"."documents"."status"::text, "public"."documents"."responsible_name", "public"."documents"."responsible_email", "public"."documents"."attachment_url", "public"."documents"."attachment_filename", "public"."documents"."file_size_bytes", "public"."documents"."file_mime_type", "public"."documents"."notes", "public"."documents"."is_archived", "public"."documents"."created_by_id", "public"."documents"."created_at", "public"."documents"."updated_at", COALESCE("aggr_selection_0_DocumentVersion"."_aggr_count_versions", 0) AS "_aggr_count_versions", COALESCE("aggr_selection_1_AuditLog"."_aggr_count_auditLogs", 0) AS "_aggr_count_auditLogs"
FROM "public"."documents"
LEFT JOIN (SELECT "public"."document_versions"."document_id", COUNT(*) AS "_aggr_count_versions" FROM "public"."document_versions" WHERE 1=1 GROUP BY "public"."document_versions"."document_id") AS "aggr_selection_0_DocumentVersion" ON ("public"."documents"."id" = "aggr_selection_0_DocumentVersion"."document_id")
LEFT JOIN (SELECT "public"."audit_logs"."document_id", COUNT(*) AS "_aggr_count_auditLogs" FROM "public"."audit_logs" WHERE 1=1 GROUP BY "public"."audit_logs"."document_id") AS "aggr_selection_1_AuditLog" ON ("public"."documents"."id" = "aggr_selection_1_AuditLog"."document_id")
WHERE "public"."documents"."is_archived" = false
ORDER BY "public"."documents"."created_at" DESC
OFFSET 0;
```

```text
Sort  (cost=11722.35..11744.91 rows=9026 width=399) (actual time=395.245..396.431 rows=9000 loops=1)
  Sort Key: documents.created_at DESC
  Sort Method: quicksort  Memory: 3110kB
  Buffers: shared hit=6836
  ->  Hash Left Join  (cost=10565.94..11129.34 rows=9026 width=399) (actual time=329.656..373.744 rows=9000 loops=1)
        Hash Cond: (documents.id = "aggr_selection_1_AuditLog".document_id)
        Buffers: shared hit=6836
        ->  Hash Left Join  (cost=1525.00..2019.64 rows=9000 width=363) (actual time=51.069..77.651 rows=9000 loops=1)
              Hash Cond: (documents.id = "aggr_selection_0_DocumentVersion".document_id)
              Buffers: shared hit=1121
              ->  Seq Scan on documents  (cost=0.00..471.00 rows=9000 width=355) (actual time=0.014..13.048 rows=9000 loops=1)
                    Filter: (NOT is_archived)
                    Rows Removed by Filter: 1000
                    Buffers: shared hit=371
              ->  Hash  (cost=1400.00..1400.00 rows=10000 width=45) (actual time=50.981..50.983 rows=10000 loops=1)
                    Buckets: 16384  Batches: 1  Memory Usage: 880kB
                    Buffers: shared hit=750
                    ->  Subquery Scan on "aggr_selection_0_DocumentVersion"  (cost=1200.00..1400.00 rows=10000 width=45) (actual time=34.006..47.125 rows=10000 loops=1)
                          Buffers: shared hit=750
                          ->  HashAggregate  (cost=1200.00..1300.00 rows=10029 width=45) (actual time=34.005..36.181 rows=10000 loops=1)
                                Group Key: document_versions.document_id
                                Batches: 1  Memory Usage: 1425kB
                                Buffers: shared hit=750
                                ->  Seq Scan on document_versions  (cost=0.00..1050.00 rows=30000 width=37) (actual time=0.004..2.762 rows=30000 loops=1)
                                      Buffers: shared hit=750
        ->  Hash  (cost=8915.58..8915.58 rows=10029 width=45) (actual time=278.500..278.501 rows=10000 loops=1)
              Buckets: 16384  Batches: 1  Memory Usage: 880kB
              Buffers: shared hit=5715
              ->  Subquery Scan on "aggr_selection_1_AuditLog"  (cost=8715.00..8915.58 rows=10029 width=45) (actual time=251.804..274.376 rows=10000 loops=1)
                    Buffers: shared hit=5715
                    ->  HashAggregate  (cost=8715.00..8815.29 rows=10029 width=45) (actual time=251.803..273.393 rows=10000 loops=1)
                          Group Key: audit_logs.document_id
                          Batches: 1  Memory Usage: 1425kB
                          Buffers: shared hit=5715
                          ->  Seq Scan on audit_logs  (cost=0.00..7715.00 rows=200000 width=37) (actual time=0.015..49.268 rows=200000 loops=1)
                                Buffers: shared hit=5715
Planning Time: 0.470 ms
Execution Time: 408.657 ms
```

### Depois (`findMany` paginado `LIMIT 20 OFFSET 0` sem `_count` e sem `versions`)

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT "public"."documents"."id", "public"."documents"."title", "public"."documents"."category_id", "public"."documents"."issuing_body", "public"."documents"."issue_date", "public"."documents"."expiration_date", "public"."documents"."alert_lead_days", "public"."documents"."status"::text, "public"."documents"."responsible_name", "public"."documents"."responsible_email", "public"."documents"."attachment_url", "public"."documents"."attachment_filename", "public"."documents"."file_size_bytes", "public"."documents"."file_mime_type", "public"."documents"."notes", "public"."documents"."is_archived", "public"."documents"."created_by_id", "public"."documents"."created_at", "public"."documents"."updated_at"
FROM "public"."documents"
WHERE "public"."documents"."is_archived" = false
ORDER BY "public"."documents"."created_at" DESC
LIMIT 20 OFFSET 0;
```

```text
Limit  (cost=0.29..2.00 rows=20 width=383) (actual time=0.026..0.040 rows=20 loops=1)
  Buffers: shared hit=3
  ->  Index Scan Backward using documents_created_at_idx on documents  (cost=0.29..773.28 rows=9000 width=383) (actual time=0.025..0.038 rows=20 loops=1)
        Filter: (NOT is_archived)
        Rows Removed by Filter: 2
        Buffers: shared hit=3
Planning Time: 0.091 ms
Execution Time: 0.084 ms
```
