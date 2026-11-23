-- Yellow marks drawn on a strip's page preview. The column is the JSON list
-- the preview paints; existing strips start unmarked.

ALTER TABLE "focusable_strip" ADD COLUMN "highlights" TEXT NOT NULL DEFAULT '[]';
