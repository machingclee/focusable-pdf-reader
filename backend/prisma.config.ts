import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Development database lives in `backend/prisma/dev.db`.
 *
 * Relative `file:` URLs are resolved by the Prisma CLI from this config file's
 * directory, so the path here is app-root relative on purpose.
 *
 * The packaged app never relies on this file: Rust passes
 * `DATABASE_URL=file:<app data dir>/database.db` to the compiled backend, and
 * `src/appDataDir.ts` supplies the same default when the binary is run by hand.
 */
const DEV_DATABASE_URL = "file:./prisma/dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? DEV_DATABASE_URL,
  },
});
