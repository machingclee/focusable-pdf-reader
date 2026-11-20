import { ensureDatabaseDir, resolveDatabasePath } from "./appDataDir.ts";
import { createPrismaClient, type AppPrisma } from "./db.ts";

/**
 * The one Prisma client for this process, created lazily.
 *
 * A module-level `createPrismaClient()` would run as soon as anything imports
 * this file, and it resolves the database path from `DATABASE_URL` (or the
 * platform app-data directory) and opens the SQLite file. Deferring that to the
 * first call means importing a module that happens to need the client never
 * binds the process to an environment it has not set up yet, and the first query
 * is the moment the path is really known.
 *
 * `src/index.ts` calls this once after migrations, so startup owns the
 * connection; routers call it inside their handlers, which is why the getter
 * returns the cached instance instead of opening a new one.
 */
let client: AppPrisma | undefined;

export function prisma(): AppPrisma {
  if (!client) {
    const databasePath = resolveDatabasePath();
    ensureDatabaseDir(databasePath);
    client = createPrismaClient(databasePath);
  }
  return client;
}
