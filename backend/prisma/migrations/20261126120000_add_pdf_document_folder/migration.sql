-- CreateTable
CREATE TABLE "pdf_document_folder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "name_lower" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL,
    "created_at" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "rel_pdf_document_folder_pdf_document" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_document_folder_id" INTEGER NOT NULL,
    "pdf_document_id" INTEGER NOT NULL,
    "ordering" INTEGER NOT NULL,
    "created_at" REAL NOT NULL,
    CONSTRAINT "rel_pdf_document_folder_pdf_document_pdf_document_folder_id_fkey" FOREIGN KEY ("pdf_document_folder_id") REFERENCES "pdf_document_folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "rel_pdf_document_folder_pdf_document_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "pdf_document_folder_name_lower_key" ON "pdf_document_folder"("name_lower");

-- CreateIndex
CREATE INDEX "pdf_document_folder_id_idx" ON "pdf_document_folder"("id");

-- CreateIndex
CREATE INDEX "pdf_document_folder_ordering_idx" ON "pdf_document_folder"("ordering");

-- CreateIndex
CREATE INDEX "rel_pdf_document_folder_pdf_document_pdf_document_folder_id_idx" ON "rel_pdf_document_folder_pdf_document"("pdf_document_folder_id");

-- CreateIndex
CREATE INDEX "rel_pdf_document_folder_pdf_document_pdf_document_id_idx" ON "rel_pdf_document_folder_pdf_document"("pdf_document_id");

-- CreateIndex
CREATE INDEX "rel_pdf_document_folder_pdf_document_pdf_document_folder_id_ordering_idx" ON "rel_pdf_document_folder_pdf_document"("pdf_document_folder_id", "ordering");

-- CreateIndex
CREATE UNIQUE INDEX "rel_pdf_document_folder_pdf_document_pdf_document_folder_id_pdf_document_id_key" ON "rel_pdf_document_folder_pdf_document"("pdf_document_folder_id", "pdf_document_id");
