-- Drag position of a document in the notes list. The list used to be newest
-- first; existing rows keep that order, with 0 at the top.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_pdf_document" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "fingerprint" TEXT,
    "page_count" INTEGER,
    "content_hash" TEXT,
    "original_path" TEXT,
    "ordering" INTEGER NOT NULL,
    "created_at" REAL NOT NULL
);
INSERT INTO "new_pdf_document" ("content_hash", "created_at", "file_path", "fingerprint", "id", "name", "original_path", "ordering", "page_count")
SELECT
    "content_hash",
    "created_at",
    "file_path",
    "fingerprint",
    "id",
    "name",
    "original_path",
    (
        SELECT COUNT(*)
        FROM "pdf_document" AS newer
        WHERE newer."created_at" > "pdf_document"."created_at"
           OR (newer."created_at" = "pdf_document"."created_at" AND newer."id" > "pdf_document"."id")
    ),
    "page_count"
FROM "pdf_document";
DROP TABLE "pdf_document";
ALTER TABLE "new_pdf_document" RENAME TO "pdf_document";
CREATE UNIQUE INDEX "pdf_document_file_path_key" ON "pdf_document"("file_path");
CREATE UNIQUE INDEX "pdf_document_content_hash_key" ON "pdf_document"("content_hash");
CREATE INDEX "pdf_document_id_idx" ON "pdf_document"("id");
CREATE INDEX "pdf_document_ordering_idx" ON "pdf_document"("ordering");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
