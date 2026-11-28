-- A pin's writing has a size of its own. The type that reads well in the margin of
-- one page is a squint on another, so the reader can take it up or down per pin and
-- the row keeps the answer: the page, a note's preview and the exported picture all
-- paint the writing at this size. Existing pins start at the default they were
-- drawn at, so nothing on an already-annotated page moves.

ALTER TABLE "annotation" ADD COLUMN "font_size" REAL NOT NULL DEFAULT 9;
