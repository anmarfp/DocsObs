-- DOC-36: indices de FK e de filtros quentes + busca trigram.
-- Somente CREATE INDEX/EXTENSION: nenhuma alteracao de dados; reversivel com
-- DROP INDEX (e DROP EXTENSION pg_trgm se nada mais depender dela).
-- Prisma executa a migration em transacao, entao CONCURRENTLY nao e possivel:
-- CREATE INDEX bloqueia escritas (nao leituras) em cada tabela enquanto o indice
-- e construido. Aceitavel no volume atual; ver docs/perf/doc-36-indices.md.

-- pg_trgm e "trusted" desde o PG 13: o dono do banco pode cria-la sem superuser.
-- Fica fora do schema.prisma (sem preview postgresqlExtensions), entao o Prisma
-- nao a gerencia nem tenta remove-la.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_document_id_timestamp_idx" ON "audit_logs"("document_id", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "company_config_updated_by_id_idx" ON "company_config"("updated_by_id");

-- CreateIndex
CREATE INDEX "document_versions_document_id_idx" ON "document_versions"("document_id");

-- CreateIndex
CREATE INDEX "document_versions_renewed_by_id_idx" ON "document_versions"("renewed_by_id");

-- CreateIndex
CREATE INDEX "documents_category_id_idx" ON "documents"("category_id");

-- CreateIndex
CREATE INDEX "documents_created_by_id_idx" ON "documents"("created_by_id");

-- CreateIndex
CREATE INDEX "documents_is_archived_status_idx" ON "documents"("is_archived", "status");

-- CreateIndex
CREATE INDEX "documents_expiration_date_idx" ON "documents"("expiration_date");

-- CreateIndex
CREATE INDEX "documents_created_at_idx" ON "documents"("created_at");

-- CreateIndex
CREATE INDEX "documents_search_trgm_idx" ON "documents" USING GIN ("title" gin_trgm_ops, "issuing_body" gin_trgm_ops, "responsible_name" gin_trgm_ops, "notes" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "gcal_sync_logs_document_id_last_synced_at_idx" ON "gcal_sync_logs"("document_id", "last_synced_at");
