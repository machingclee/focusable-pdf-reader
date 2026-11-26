-- The notes folder is `note_folder` and the saved strip is `note`.
--
-- The migrator runs with foreign keys off, and SQLite then leaves a renamed
-- table's old name inside other tables' foreign keys. Copy both tables under
-- their new names so the constraints are written correctly. Older migration
-- files stay as history.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "note_folder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_document_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL,
    "created_at" REAL NOT NULL,
    CONSTRAINT "note_folder_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "note_folder" ("id", "pdf_document_id", "name", "ordering", "created_at")
SELECT "id", "pdf_document_id", "name", "ordering", "created_at"
FROM "folder";

CREATE TABLE "note" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_document_id" INTEGER NOT NULL,
    "note_folder_id" INTEGER,
    "ordering" INTEGER NOT NULL,
    "page_number" INTEGER NOT NULL,
    "top" REAL NOT NULL,
    "height" REAL NOT NULL,
    "left" REAL NOT NULL,
    "width" REAL NOT NULL,
    "page_width" REAL NOT NULL,
    "page_height" REAL NOT NULL,
    "text_excerpt" TEXT,
    "remark" TEXT NOT NULL DEFAULT '',
    "created_at" REAL NOT NULL,
    CONSTRAINT "note_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "note_note_folder_id_fkey" FOREIGN KEY ("note_folder_id") REFERENCES "note_folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "note" (
    "id",
    "pdf_document_id",
    "note_folder_id",
    "ordering",
    "page_number",
    "top",
    "height",
    "left",
    "width",
    "page_width",
    "page_height",
    "text_excerpt",
    "remark",
    "created_at"
)
SELECT
    "id",
    "pdf_document_id",
    "folder_id",
    "ordering",
    "page_number",
    "top",
    "height",
    "left",
    "width",
    "page_width",
    "page_height",
    "text_excerpt",
    "remark",
    "created_at"
FROM "focusable_strip";

DROP TABLE "focusable_strip";
DROP TABLE "folder";

CREATE INDEX "note_folder_id_idx" ON "note_folder"("id");
CREATE INDEX "note_folder_pdf_document_id_ordering_idx" ON "note_folder"("pdf_document_id", "ordering");
CREATE INDEX "note_note_folder_id_ordering_idx" ON "note"("note_folder_id", "ordering");
CREATE INDEX "note_pdf_document_id_ordering_idx" ON "note"("pdf_document_id", "ordering");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
