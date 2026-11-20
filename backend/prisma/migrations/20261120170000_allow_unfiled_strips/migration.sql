-- Folder membership becomes optional: a strip can sit in "no folder", which is
-- how the strip menu's "Move to folder" offers to take it out of every folder.
--
-- The document it belongs to moves back onto the strip. A folder-less strip has
-- no relation left to walk to find its document, and every list in the app asks
-- for "the strips of this document". Existing rows take their document from the
-- folder they are in today.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_focusable_strip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_document_id" INTEGER NOT NULL,
    "folder_id" INTEGER,
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
    CONSTRAINT "focusable_strip_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "focusable_strip_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_focusable_strip" (
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
)
SELECT
    s."id",
    f."pdf_document_id",
    s."folder_id",
    s."ordering",
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
JOIN "folder" AS f ON f."id" = s."folder_id";

DROP TABLE "focusable_strip";
ALTER TABLE "new_focusable_strip" RENAME TO "focusable_strip";

CREATE INDEX "focusable_strip_folder_id_ordering_idx" ON "focusable_strip"("folder_id", "ordering");
CREATE INDEX "focusable_strip_pdf_document_id_ordering_idx" ON "focusable_strip"("pdf_document_id", "ordering");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
