// AUTO-GENERATED FILE - do not edit.
// Produced by scripts/build-migrations.ts from C:\Repos\javascript\focusable-pdf-reader\backend\prisma\audit\migrations/*/migration.sql.
// Run `bun run migrations:bundle` after creating a migration.

export type BundledMigration = {
  /** Migration folder name, e.g. "20261119082300_init". */
  name: string;
  /** Full contents of that folder's migration.sql. */
  sql: string;
};

export const bundledAuditMigrations: BundledMigration[] = [
  {
    name: "20261121165115_init",
    sql: "-- CreateTable\r\nCREATE TABLE \"event_audit\" (\r\n    \"id\" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,\r\n    \"request_id\" TEXT NOT NULL,\r\n    \"kind\" TEXT NOT NULL,\r\n    \"event_type\" TEXT NOT NULL,\r\n    \"payload\" TEXT NOT NULL,\r\n    \"event_order\" INTEGER NOT NULL,\r\n    \"request_user_email\" TEXT,\r\n    \"success\" BOOLEAN NOT NULL,\r\n    \"failure_reason\" TEXT NOT NULL DEFAULT '',\r\n    \"created_at\" REAL NOT NULL\r\n);\r\n\r\n-- CreateIndex\r\nCREATE INDEX \"event_audit_request_id_idx\" ON \"event_audit\"(\"request_id\");\r\n\r\n-- CreateIndex\r\nCREATE INDEX \"event_audit_created_at_idx\" ON \"event_audit\"(\"created_at\");\r\n",
  },
  {
    name: "20261122170000_remove_event_audit_kind",
    sql: "-- The audit row no longer carries a command/event discriminator.\r\nALTER TABLE \"event_audit\" DROP COLUMN \"kind\";\r\n",
  },
];
