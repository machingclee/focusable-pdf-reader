-- CreateTable
CREATE TABLE "pdf_document" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "fingerprint" TEXT,
    "page_count" INTEGER,
    "created_at" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "focusable_strip" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_document_id" INTEGER NOT NULL,
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
    CONSTRAINT "focusable_strip_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "pdf_document_file_path_key" ON "pdf_document"("file_path");

-- CreateIndex
CREATE INDEX "focusable_strip_pdf_document_id_page_number_idx" ON "focusable_strip"("pdf_document_id", "page_number");
