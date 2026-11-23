-- A highlight belongs to the document, on a page, not to a strip. Existing
-- strokes keep the page of the strip they were drawn on. Deleting a document
-- still deletes its marks; deleting a strip no longer does.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_highlight" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_document_id" INTEGER NOT NULL,
    "page_number" INTEGER NOT NULL,
    "x0" REAL NOT NULL,
    "x1" REAL NOT NULL,
    "y" REAL NOT NULL,
    "size" REAL NOT NULL,
    "created_at" REAL NOT NULL,
    CONSTRAINT "highlight_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_highlight" (
    "id",
    "pdf_document_id",
    "page_number",
    "x0",
    "x1",
    "y",
    "size",
    "created_at"
)
SELECT
    h."id",
    s."pdf_document_id",
    s."page_number",
    h."x0",
    h."x1",
    h."y",
    h."size",
    h."created_at"
FROM "highlight" AS h
JOIN "focusable_strip" AS s ON s."id" = h."focusable_strip_id";

DROP TABLE "highlight";
ALTER TABLE "new_highlight" RENAME TO "highlight";

CREATE INDEX "highlight_id_idx" ON "highlight"("id");
CREATE INDEX "highlight_pdf_document_id_page_number_idx" ON "highlight"("pdf_document_id", "page_number");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
