import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { PrismaClient } from "../../generated/audit-prisma/client.ts";

/**
 * Prisma client for the audit database.
 *
 * This client uses the audit-only generated schema and its own SQLite file, so
 * its transactions are independent of the business database.
 */
export function createAuditPrismaClient(databasePath: string) {
  const adapter = new PrismaBunSqlite({
    url: databasePath === ":memory:" ? ":memory:" : `file:${databasePath}`,
  });
  return new PrismaClient({ adapter });
}

export type AuditPrisma = ReturnType<typeof createAuditPrismaClient>;
