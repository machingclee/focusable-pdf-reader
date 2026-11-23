-- A strip owns its preview marks. Each row is one horizontal stroke that used
-- to live in the strip's JSON list. Existing marks move across, in list order,
-- and the column goes away.

CREATE TABLE "highlight" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "focusable_strip_id" INTEGER NOT NULL,
    "x0" REAL NOT NULL,
    "x1" REAL NOT NULL,
    "y" REAL NOT NULL,
    "size" REAL NOT NULL,
    "created_at" REAL NOT NULL,
    CONSTRAINT "highlight_focusable_strip_id_fkey" FOREIGN KEY ("focusable_strip_id") REFERENCES "focusable_strip" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "highlight" ("focusable_strip_id", "x0", "x1", "y", "size", "created_at")
SELECT
    s."id",
    json_extract(j.value, '$.x0'),
    json_extract(j.value, '$.x1'),
    json_extract(j.value, '$.y'),
    json_extract(j.value, '$.size'),
    s."created_at"
FROM "focusable_strip" AS s, json_each(s."highlights") AS j
WHERE json_valid(s."highlights")
  AND json_type(s."highlights") = 'array'
  AND json_type(j.value) = 'object';

CREATE INDEX "highlight_id_idx" ON "highlight"("id");
CREATE INDEX "highlight_focusable_strip_id_idx" ON "highlight"("focusable_strip_id");

ALTER TABLE "focusable_strip" DROP COLUMN "highlights";
