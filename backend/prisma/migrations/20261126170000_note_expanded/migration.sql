-- A note starts open. Folding it hides the writing under the preview and
-- leaves the preview, which is where the control sits: a note captured only
-- so another note can point at it has no writing of its own.

ALTER TABLE "note" ADD COLUMN "expanded" BOOLEAN NOT NULL DEFAULT true;
