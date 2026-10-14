-- DOC-37: Garante unicidade de (document_id, version_number) em document_versions.
-- Antes de aplicar o indice unico, renumera eventuais versoes duplicadas por documento
-- para evitar falha na criacao do indice sem perder nenhum registro historico.
UPDATE document_versions dv
SET version_number = r.rn
FROM (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY document_id
        ORDER BY version_number, created_at, id
    ) AS rn
    FROM document_versions
) r
WHERE dv.id = r.id AND dv.version_number <> r.rn;

-- DropIndex
DROP INDEX "document_versions_document_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");
