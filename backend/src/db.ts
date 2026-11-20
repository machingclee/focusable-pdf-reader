import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "./generated/prisma/client.ts";

/**
 * Prisma client backed by Bun's built-in SQLite (`bun:sqlite`) through the
 * community driver adapter, so the standalone binary needs no native addon.
 *
 * The schema has no DateTime columns: `created_at` is a unix-epoch-millisecond
 * Float written by the API, and there is no `updated_at` to maintain.
 *
 * The `_prisma_migrations` bookkeeping table is written by `src/migrate.ts` in
 * the format the Prisma CLI uses, and is never read through this client.
 */
export function createPrismaClient(databasePath: string) {
  const adapter = new PrismaBunSqlite({
    url: databasePath === ":memory:" ? ":memory:" : `file:${databasePath}`,
  });
  return new PrismaClient({ adapter });
}

export type AppPrisma = ReturnType<typeof createPrismaClient>;
