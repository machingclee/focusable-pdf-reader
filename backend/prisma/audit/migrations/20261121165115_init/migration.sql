-- CreateTable
CREATE TABLE "event_audit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "request_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "event_order" INTEGER NOT NULL,
    "request_user_email" TEXT,
    "success" BOOLEAN NOT NULL,
    "failure_reason" TEXT NOT NULL DEFAULT '',
    "created_at" REAL NOT NULL
);

-- CreateIndex
CREATE INDEX "event_audit_request_id_idx" ON "event_audit"("request_id");

-- CreateIndex
CREATE INDEX "event_audit_created_at_idx" ON "event_audit"("created_at");
