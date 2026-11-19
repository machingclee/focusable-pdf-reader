/**
 * Standalone backend entry point.
 *
 * Startup order: resolve the database path, apply bundled migrations, connect
 * Prisma, listen on 127.0.0.1, then print `BACKEND_READY port=<n>` on stdout.
 * Rust parses that single line, everything else goes to stderr.
 */
import { fstatSync } from "node:fs";
import { createApp } from "./app.ts";
import { ensureDatabaseDir, resolveDatabasePath } from "./appDataDir.ts";
import { createPrismaClient } from "./db.ts";
import { applyMigrations } from "./migrate.ts";

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

const prisma = createPrismaClient(databasePath);
const app = createApp({ prisma });

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
    void prisma
      .$disconnect()
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
