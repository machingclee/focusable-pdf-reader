/**
 * Applies Prisma migrations from inside the running backend.
 *
 * The Prisma migrate CLI cannot be bundled into the standalone binary, so the
 * SQL is compiled in (`migrations.generated.ts`). To keep development
 * and packaged databases interchangeable this module writes the same
 * `_prisma_migrations` rows Prisma does: same columns, same sha256 checksums,
 * same unix-epoch-millisecond timestamps.
 */
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, statSync } from "node:fs";
import { ensureDatabaseDir } from "../../common/appDataDir.ts";
import { bundledMigrations, type BundledMigration } from "./migrations.generated.ts";

/** Exactly the table Prisma Migrate creates for SQLite. */
const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
);
`;

type MigrationRow = {
  id: string;
  checksum: string;
  migration_name: string;
  finished_at: number | string | null;
  rolled_back_at: number | string | null;
  started_at: number | string | null;
};

export type MigrationResult = {
  /** Migrations applied by this call, in order. */
  applied: string[];
  /** Migrations that were already applied and left alone. */
  skipped: string[];
  /** Backup copy made before writing, if any. */
  backupPath: string | null;
};

export type MigrationOptions = {
  migrations?: BundledMigration[];
  logger?: (message: string) => void;
  /** Copy the database before applying anything. Defaults to true. */
  backup?: boolean;
};

/** An applied migration's SQL no longer matches the bundled copy. */
export class MigrationChecksumError extends Error {
  constructor(
    readonly migrationName: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Migration "${migrationName}" was modified after it was applied ` +
      `(applied checksum ${actual}, bundled checksum ${expected}). ` +
      `Restore the original migration file or reset the database; refusing to start.`,
    );
    this.name = "MigrationChecksumError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isApplied(row: MigrationRow): boolean {
  return row.finished_at !== null && row.rolled_back_at === null;
}

function isBackupCandidate(path: string): boolean {
  if (path === ":memory:" || !existsSync(path)) return false;
  return statSync(path).size > 0;
}

function backupTimestamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Apply every bundled migration that the database does not have yet.
 *
 * Each migration runs in its own transaction with foreign keys temporarily
 * disabled (Prisma's SQLite migrations rebuild tables and need that), followed
 * by `PRAGMA foreign_key_check`. The database file is backed up first.
 */
export function applyMigrations(databasePath: string, options: MigrationOptions = {}): MigrationResult {
  const migrations = options.migrations ?? bundledMigrations;
  const log = options.logger ?? ((message: string) => console.error(`[migrate] ${message}`));
  const shouldBackup = options.backup ?? true;

  ensureDatabaseDir(databasePath);

  // Decide on the backup before the connection exists: opening a database
  // creates an empty file, and a brand new database has nothing worth saving.
  const hadDataBeforeMigrating = isBackupCandidate(databasePath);

  const db = new Database(databasePath, { create: true, strict: true });
  try {
    db.exec(CREATE_MIGRATIONS_TABLE);

    const rows = db
      .query<MigrationRow, []>(
        `SELECT "id", "checksum", "migration_name", "finished_at", "rolled_back_at", "started_at"
         FROM "_prisma_migrations"`,
      )
      .all();

    const appliedByName = new Map<string, MigrationRow>();
    for (const row of rows) {
      if (isApplied(row)) appliedByName.set(row.migration_name, row);
    }

    const knownNames = new Set(migrations.map((migration) => migration.name));
    for (const name of appliedByName.keys()) {
      if (!knownNames.has(name)) {
        log(`warning: migration "${name}" is recorded in the database but not bundled in this binary`);
      }
    }

    // Refuse to run against a database whose history no longer matches the code.
    for (const migration of migrations) {
      const applied = appliedByName.get(migration.name);
      if (!applied) continue;
      const expected = sha256(migration.sql);
      if (applied.checksum !== expected) {
        throw new MigrationChecksumError(migration.name, expected, applied.checksum);
      }
    }

    const pending = migrations.filter((migration) => !appliedByName.has(migration.name));
    const skipped = migrations.filter((migration) => appliedByName.has(migration.name)).map((m) => m.name);

    if (pending.length === 0) {
      log(`database is up to date (${skipped.length} migration(s))`);
      return { applied: [], skipped, backupPath: null };
    }

    let backupPath: string | null = null;
    if (shouldBackup && hadDataBeforeMigrating) {
      backupPath = `${databasePath}.bak-${backupTimestamp()}`;
      copyFileSync(databasePath, backupPath);
      log(`backed up database to ${backupPath}`);
    }

    const insertMigration = db.prepare(
      `INSERT INTO "_prisma_migrations"
         ("id", "checksum", "migration_name", "finished_at", "started_at", "applied_steps_count")
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    );

    const applied: string[] = [];
    for (const migration of pending) {
      const checksum = sha256(migration.sql);
      const startedAt = Date.now();

      db.exec("PRAGMA foreign_keys = OFF");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(migration.sql);
        insertMigration.run(randomUUID(), checksum, migration.name, Date.now(), startedAt, 1);
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // The transaction is already gone; the original error is what matters.
        }
        throw new Error(`Migration "${migration.name}" failed: ${(error as Error).message}`, { cause: error });
      } finally {
        db.exec("PRAGMA foreign_keys = ON");
      }

      const violations = db.query("PRAGMA foreign_key_check").all();
      if (violations.length > 0) {
        throw new Error(
          `Migration "${migration.name}" left ${violations.length} foreign key violation(s): ${JSON.stringify(violations)}`,
        );
      }

      applied.push(migration.name);
      log(`applied ${migration.name}`);
    }

    return { applied, skipped, backupPath };
  } finally {
    db.close();
  }
}
