-- Width of the Documents rail in the Notes tab, in CSS px. The seam between the
-- two panes is a grab edge, so the reader's split outlives the window the way the
-- docked columns' width does. An existing row keeps its defaults: null, which the
-- client reads as "start at the default width".

ALTER TABLE "app_state" ADD COLUMN "notes_documents_width" INTEGER;
