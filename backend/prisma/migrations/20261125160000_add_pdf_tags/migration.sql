-- CreateTable
CREATE TABLE "pdf_tag_folder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "name_lower" TEXT NOT NULL,
    "ordering" INTEGER NOT NULL,
    "created_at" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "pdf_tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "name_lower" TEXT NOT NULL,
    "pdf_tag_folder_id" INTEGER,
    "created_at" REAL NOT NULL,
    CONSTRAINT "pdf_tag_pdf_tag_folder_id_fkey" FOREIGN KEY ("pdf_tag_folder_id") REFERENCES "pdf_tag_folder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "assigned_pdf_tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_tag_id" INTEGER NOT NULL,
    "created_at" REAL NOT NULL,
    CONSTRAINT "assigned_pdf_tag_pdf_tag_id_fkey" FOREIGN KEY ("pdf_tag_id") REFERENCES "pdf_tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rel_pdf_document_assigned_pdf_tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pdf_document_id" INTEGER NOT NULL,
    "assigned_pdf_tag_id" INTEGER NOT NULL,
    "created_at" REAL NOT NULL,
    CONSTRAINT "rel_pdf_document_assigned_pdf_tag_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "rel_pdf_document_assigned_pdf_tag_assigned_pdf_tag_id_fkey" FOREIGN KEY ("assigned_pdf_tag_id") REFERENCES "assigned_pdf_tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "pdf_tag_folder_name_lower_key" ON "pdf_tag_folder"("name_lower");

-- CreateIndex
CREATE INDEX "pdf_tag_folder_id_idx" ON "pdf_tag_folder"("id");

-- CreateIndex
CREATE INDEX "pdf_tag_folder_ordering_idx" ON "pdf_tag_folder"("ordering");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_tag_name_lower_key" ON "pdf_tag"("name_lower");

-- CreateIndex
CREATE INDEX "pdf_tag_id_idx" ON "pdf_tag"("id");

-- CreateIndex
CREATE INDEX "pdf_tag_pdf_tag_folder_id_idx" ON "pdf_tag"("pdf_tag_folder_id");

-- CreateIndex
CREATE INDEX "assigned_pdf_tag_id_idx" ON "assigned_pdf_tag"("id");

-- CreateIndex
CREATE INDEX "assigned_pdf_tag_pdf_tag_id_idx" ON "assigned_pdf_tag"("pdf_tag_id");

-- CreateIndex
CREATE INDEX "rel_pdf_document_assigned_pdf_tag_pdf_document_id_idx" ON "rel_pdf_document_assigned_pdf_tag"("pdf_document_id");

-- CreateIndex
CREATE INDEX "rel_pdf_document_assigned_pdf_tag_assigned_pdf_tag_id_idx" ON "rel_pdf_document_assigned_pdf_tag"("assigned_pdf_tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "rel_pdf_document_assigned_pdf_tag_pdf_document_id_assigned_pdf_tag_id_key" ON "rel_pdf_document_assigned_pdf_tag"("pdf_document_id", "assigned_pdf_tag_id");

