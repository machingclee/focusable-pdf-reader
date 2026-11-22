// AUTO-GENERATED FILE - do not edit.
// Produced by scripts/build-migrations.ts from /Users/chingcheonglee/Repos/Javascript/2026-08-23-tauri-pdf-focus-viewer/backend/prisma/audit/migrations/*/migration.sql.
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
    sql: "-- CreateTable\nCREATE TABLE \"event_audit\" (\n    \"id\" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,\n    \"request_id\" TEXT NOT NULL,\n    \"kind\" TEXT NOT NULL,\n    \"event_type\" TEXT NOT NULL,\n    \"payload\" TEXT NOT NULL,\n    \"event_order\" INTEGER NOT NULL,\n    \"request_user_email\" TEXT,\n    \"success\" BOOLEAN NOT NULL,\n    \"failure_reason\" TEXT NOT NULL DEFAULT '',\n    \"created_at\" REAL NOT NULL\n);\n\n-- CreateIndex\nCREATE INDEX \"event_audit_request_id_idx\" ON \"event_audit\"(\"request_id\");\n\n-- CreateIndex\nCREATE INDEX \"event_audit_created_at_idx\" ON \"event_audit\"(\"created_at\");\n",
  },
  {
    name: "20261122170000_remove_event_audit_kind",
    sql: "-- The audit row no longer carries a command/event discriminator.\nALTER TABLE \"event_audit\" DROP COLUMN \"kind\";\n",
  },
];
