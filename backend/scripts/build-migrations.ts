/**
 * Builds the bundled migration files from both Prisma migration folders:
 *
 * - `prisma/migrations/*\/migration.sql` -> `src/infrastructure/prisma/migrations.generated.ts`
 * - `prisma/audit/migrations/*\/migration.sql` -> `src/infrastructure/prisma/auditMigrations.generated.ts`
 *
 * The SQL is compiled into the standalone binary. Run `bun run migrations:bundle`
 * after creating a migration in either folder.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");

type MigrationFile = { name: string; sql: string };

type Bundle = {
  migrationsDir: string;
  outputFile: string;
  exportName: string;
  label: string;
};

const bundles: Bundle[] = [
  {
    migrationsDir: join(projectRoot, "prisma", "migrations"),
    outputFile: join(projectRoot, "src", "infrastructure", "prisma", "migrations.generated.ts"),
    exportName: "bundledMigrations",
    label: "main",
  },
  {
    migrationsDir: join(projectRoot, "prisma", "audit", "migrations"),
    outputFile: join(
      projectRoot,
      "src",
      "infrastructure",
      "prisma",
      "auditMigrations.generated.ts",
    ),
    exportName: "bundledAuditMigrations",
    label: "audit",
  },
];

function readMigrations(migrationsDir: string): MigrationFile[] {
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

function render(
  migrations: MigrationFile[],
  exportName: string,
  migrationsDir: string,
): string {
  const body = migrations
    .map(
      (migration) =>
        `  {\n    name: ${JSON.stringify(migration.name)},\n    sql: ${JSON.stringify(migration.sql)},\n  },`,
    )
    .join("\n");

  return `// AUTO-GENERATED FILE - do not edit.
// Produced by scripts/build-migrations.ts from ${migrationsDir}/*/migration.sql.
// Run \`bun run migrations:bundle\` after creating a migration.

export type BundledMigration = {
  /** Migration folder name, e.g. "20261119082300_init". */
  name: string;
  /** Full contents of that folder's migration.sql. */
  sql: string;
};

export const ${exportName}: BundledMigration[] = [
${body}
];
`;
}

for (const bundle of bundles) {
  const migrations = readMigrations(bundle.migrationsDir);
  writeFileSync(
    bundle.outputFile,
    render(migrations, bundle.exportName, bundle.migrationsDir),
    "utf8",
  );
  console.log(
    `[migrations:${bundle.label}] bundled ${migrations.length} migration(s) into ${bundle.outputFile}`,
  );
}
