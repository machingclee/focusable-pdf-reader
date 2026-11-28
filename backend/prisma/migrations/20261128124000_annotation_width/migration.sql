-- A pin's content is a note-like surface with its own width: the reader drags the
-- content's edge, and the row keeps what they chose so the markdown wraps the same
-- way on the next page load. Existing pins start at the width they were drawn at.

ALTER TABLE "annotation" ADD COLUMN "width" REAL NOT NULL DEFAULT 150;
