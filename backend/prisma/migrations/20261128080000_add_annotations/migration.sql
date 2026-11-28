-- Text pinned to a place on a document's page. The document owns the rows, the
-- same way it owns its highlight strokes: deleting the PDF deletes them, and a
-- strip's preview only paints the ones on its own page.

CREATE TABLE "annotation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_document_id" INTEGER NOT NULL,
    "page_number" INTEGER NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" REAL NOT NULL,
    CONSTRAINT "annotation_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "annotation_id_idx" ON "annotation"("id");
CREATE INDEX "annotation_pdf_document_id_page_number_idx" ON "annotation"("pdf_document_id", "page_number");
