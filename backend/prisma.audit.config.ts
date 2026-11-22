import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Development audit database lives in `backend/prisma/audit/dev.db`.
 *
 * The packaged app never relies on this file: the backend derives `audit.db`
 * beside `DATABASE_URL`, or accepts `AUDIT_DATABASE_URL`.
 */
const DEV_AUDIT_DATABASE_URL = "file:./prisma/audit/dev.db";

export default defineConfig({
  schema: "prisma/audit/schema.prisma",
  migrations: {
    path: "prisma/audit/migrations",
  },
  datasource: {
    url: process.env.AUDIT_DATABASE_URL ?? DEV_AUDIT_DATABASE_URL,
  },
});
