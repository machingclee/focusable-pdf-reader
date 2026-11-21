-- The app keeps its own copy of every PDF it opens, named by the sha256 of the
-- bytes, and reads only that copy. `file_path` points into the library from now
-- on; these two columns say which content it is and where it came from.
--
-- Both are nullable, so a row written before this change keeps working until its
-- file is opened again: `content_hash` is null for a document whose notes are
-- still stored against the reader's own path.

-- AlterTable
ALTER TABLE "pdf_document" ADD COLUMN "content_hash" TEXT;
ALTER TABLE "pdf_document" ADD COLUMN "original_path" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "pdf_document_content_hash_key" ON "pdf_document"("content_hash");
