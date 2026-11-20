-- A document owns folders; a folder owns the strips that used to hang directly
-- off the document. Existing strips move into one folder per document, named
-- "Strips", keeping their previous page-and-position order.

-- CreateTable
CREATE TABLE "folder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_document_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL,
    "created_at" REAL NOT NULL,
    CONSTRAINT "folder_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One folder for each document that already has strips. Documents with none
-- stay folder-less until the first strip is saved.
INSERT INTO "folder" ("pdf_document_id", "name", "ordering", "created_at")
SELECT d."id", 'Strips', 0, d."created_at"
FROM "pdf_document" AS d
WHERE d."id" IN (SELECT DISTINCT "pdf_document_id" FROM "focusable_strip");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_focusable_strip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "folder_id" INTEGER NOT NULL,
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
    CONSTRAINT "focusable_strip_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_focusable_strip" (
    "id",
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
)
SELECT
    s."id",
    f."id",
    (
        SELECT COUNT(*)
        FROM "focusable_strip" AS earlier
        WHERE earlier."pdf_document_id" = s."pdf_document_id"
          AND (
            earlier."page_number" < s."page_number"
            OR (earlier."page_number" = s."page_number" AND earlier."top" < s."top")
            OR (
                earlier."page_number" = s."page_number"
                AND earlier."top" = s."top"
                AND earlier."id" < s."id"
            )
          )
    ),
    s."page_number",
    s."top",
    s."height",
    s."left",
    s."width",
    s."page_width",
    s."page_height",
    s."text_excerpt",
    s."remark",
    s."created_at"
FROM "focusable_strip" AS s
JOIN "folder" AS f ON f."pdf_document_id" = s."pdf_document_id";
DROP TABLE "focusable_strip";
ALTER TABLE "new_focusable_strip" RENAME TO "focusable_strip";
CREATE INDEX "focusable_strip_folder_id_ordering_idx" ON "focusable_strip"("folder_id", "ordering");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "folder_id_idx" ON "folder"("id");

-- CreateIndex
CREATE INDEX "folder_pdf_document_id_ordering_idx" ON "folder"("pdf_document_id", "ordering");
