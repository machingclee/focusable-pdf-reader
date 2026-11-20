-- One row per remembered UI setting (panel widths and, later, whatever else).
-- Values are TEXT so adding a setting needs no migration.
CREATE TABLE "app_state" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at" REAL NOT NULL
);
