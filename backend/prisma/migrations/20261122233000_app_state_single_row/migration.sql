-- One row. Each column is one remembered setting. The old table was one row
-- per dotted key; notes_panel.width and event_log.width move into columns.

CREATE TABLE "new_app_state" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "notes_panel_width" INTEGER,
    "event_log_panel_width" INTEGER,
    "last_opened_pdf_document_id" INTEGER,
    "updated_at" REAL NOT NULL,
    CONSTRAINT "app_state_id_singleton" CHECK ("id" = 1),
    CONSTRAINT "app_state_last_opened_pdf_document_id_fkey"
        FOREIGN KEY ("last_opened_pdf_document_id") REFERENCES "pdf_document" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_app_state" (
    "id",
    "notes_panel_width",
    "event_log_panel_width",
    "last_opened_pdf_document_id",
    "updated_at"
)
SELECT
    1,
    CAST((SELECT "value" FROM "app_state" WHERE "key" = 'notes_panel.width') AS INTEGER),
    CAST((SELECT "value" FROM "app_state" WHERE "key" = 'event_log.width') AS INTEGER),
    NULL,
    COALESCE((SELECT MAX("updated_at") FROM "app_state"), 0);

DROP TABLE "app_state";
ALTER TABLE "new_app_state" RENAME TO "app_state";

CREATE INDEX "app_state_id_idx" ON "app_state"("id");
