/**
 * Standalone backend entry point.
 *
 * Startup order: resolve the database path, apply the migration bundle,
 * connect the Prisma client, listen on 127.0.0.1, then print
 * `BACKEND_READY port=<n>` on stdout.
 * Rust parses that single line, everything else goes to stderr.
 */
import { fstatSync } from "node:fs";
import { app } from "./app.ts";
import { initializeCqrs } from "express-prisma-cqrs";
import { PDF_NOTE_MANAGEMENT_COMPONENTS } from "./bounded-contexts/components.ts";
import { PrismaAuditEventRepository } from "./infrastructure/prisma/auditWriter.ts";
import { PrismaUnitOfWork } from "./infrastructure/prisma/unitOfWork.ts";
import {
  ensureDatabaseDir,
  resolveDatabasePath,
} from "./common/appDataDir.ts";
import { prisma } from "./infrastructure/prisma/instance.ts";
import { applyMigrations } from "./infrastructure/prisma/migrate.ts";

const HOST = process.env.HOST?.trim() || "127.0.0.1";
const REQUESTED_PORT = process.env.PORT?.trim() || "0";

function parsePort(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    console.error(`[backend] PORT must be an integer, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(port) || port > 65535) {
    console.error(`[backend] PORT must be between 0 and 65535, got ${port}`);
    process.exit(1);
  }
  return port;
}

/** Would closing our stdin mean the parent process died? */
function stdinIsParentPipe(): boolean {
  const override = process.env.BACKEND_STDIN_WATCHDOG?.trim();
  if (override === "1") return true;
  if (override === "0") return false;
  try {
    return fstatSync(0).isFIFO() || fstatSync(0).isSocket();
  } catch {
    return false;
  }
}

const port = parsePort(REQUESTED_PORT);
const databasePath = resolveDatabasePath();
ensureDatabaseDir(databasePath);

try {
  const result = applyMigrations(databasePath);
  if (result.applied.length > 0) {
    console.error(`[backend] applied ${result.applied.length} migration(s): ${result.applied.join(", ")}`);
  }
} catch (error) {
  console.error(`[backend] migration failed, cannot start: ${(error as Error).message}`);
  process.exit(1);
}


// Created here, after migrations have run, so startup owns the connections and
// the shutdown handler below closes the same instances the routers use.
const db = prisma();
const unitOfWork = new PrismaUnitOfWork(db);

// Wiring the pipeline before listening means a missing/duplicate handler or an
// un-decorated command fails at startup instead of on the first request.
try {
  initializeCqrs({
    components: PDF_NOTE_MANAGEMENT_COMPONENTS,
    auditEventRepository: new PrismaAuditEventRepository(db),
    transactionRunner: unitOfWork,
    configure: (container) => {
      container.registerValue(PrismaUnitOfWork, unitOfWork);
    },
  });
} catch (error) {
  console.error(`[backend] domain wiring failed, cannot start: ${(error as Error).message}`);
  process.exit(1);
}

const server = app.listen(port, HOST);

server.on("error", (error) => {
  console.error(`[backend] failed to listen on ${HOST}:${port}: ${(error as Error).message}`);
  process.exit(1);
});

server.on("listening", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  console.error(`[backend] database: ${databasePath}`);
  console.error(`[backend] listening on http://${HOST}:${actualPort}`);
  console.log(`BACKEND_READY port=${actualPort}`);
});

let shuttingDown = false;

function shutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[backend] shutting down (${reason})`);

  const finish = () => {
    void db.$disconnect()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };

  server.close(() => finish());
  // A hung connection must not keep the process alive forever.
  setTimeout(finish, 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// When the Tauri app dies (including a crash or force quit) our stdin closes.
// That is the backstop for Rust not getting the chance to kill us itself.
if (stdinIsParentPipe()) {
  process.stdin.resume();
  process.stdin.on("end", () => shutdown("stdin closed"));
  process.stdin.on("close", () => shutdown("stdin closed"));
  process.stdin.on("error", () => shutdown("stdin error"));
}
