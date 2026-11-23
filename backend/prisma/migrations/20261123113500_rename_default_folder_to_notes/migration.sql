-- The folder a document opens with when its first strip is saved was called
-- "Strips". It holds the notes of that document, so it now says "Notes".
--
-- Folders are named data, not shape: the folder is created by
-- CreateFocusableStrip and only its name row changes here. A document that
-- already has a folder of its own called "Notes" keeps both names as they are,
-- so the list never shows the same name twice.

UPDATE "folder"
SET "name" = 'Notes'
WHERE "name" = 'Strips'
  AND NOT EXISTS (
    SELECT 1
    FROM "folder" AS other
    WHERE other."pdf_document_id" = "folder"."pdf_document_id"
      AND other."name" = 'Notes'
      AND other."id" <> "folder"."id"
  );
