/**
 * Builds `src/migrations.generated.ts` from the migration.sql file in each
 * `prisma/migrations/<timestamp>_<name>/` directory,
 * so the migration SQL is compiled into the standalone binary.
 *
 * Usage: bun scripts/build-migrations.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const migrationsDir = join(projectRoot, "prisma", "migrations");
const outputFile = join(projectRoot, "src", "migrations.generated.ts");

type MigrationFile = { name: string; sql: string };

function readMigrations(): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(migrationsDir);
  } catch {
    return [];
  }

  return entries
    .filter((name) => !name.startsWith(".") && name !== "migration_lock.toml")
    .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const sqlPath = join(migrationsDir, name, "migration.sql");
      const sql = readFileSync(sqlPath, "utf8");
      return { name, sql };
    });
}

function render(migrations: MigrationFile[]): string {
  const body = migrations
    .map((migration) => `  {\n    name: ${JSON.stringify(migration.name)},\n    sql: ${JSON.stringify(migration.sql)},\n  },`)
    .join("\n");

  return `// AUTO-GENERATED FILE - do not edit.
// Produced by scripts/build-migrations.ts from prisma/migrations/*/migration.sql.
// Run \`bun run migrations:bundle\` after creating a migration.

export type BundledMigration = {
  /** Migration folder name, e.g. "20261119082300_init". */
  name: string;
  /** Full contents of that folder's migration.sql. */
  sql: string;
};

export const bundledMigrations: BundledMigration[] = [
${body}
];
`;
}

const migrations = readMigrations();
writeFileSync(outputFile, render(migrations), "utf8");
console.log(`[migrations] bundled ${migrations.length} migration(s) into ${outputFile}`);
