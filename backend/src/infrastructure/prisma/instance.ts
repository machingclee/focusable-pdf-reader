import {
  ensureDatabaseDir,
  resolveDatabasePath,
} from "../../common/appDataDir.ts";
import { createPrismaClient, type AppPrisma } from "./client.ts";

/**
 * Lazy Prisma client for this process.
 *
 * A module-level client would open its SQLite file as soon as anything imports
 * this file. Deferring creation means importing a module that needs the client
 * does not bind the process before the tests or the packaged app set the path.
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
