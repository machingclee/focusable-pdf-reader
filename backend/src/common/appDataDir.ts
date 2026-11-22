import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Same identifier Tauri uses for `app_data_dir()`, so the backend and the
 * Tauri shell agree on where application data lives.
 */
export const APP_IDENTIFIER = "com.machingclee.pdf-focus-viewer";

export const DATABASE_FILENAME = "database.db";
export const AUDIT_DATABASE_FILENAME = "audit.db";

/**
 * The folder Tauri's `app_data_dir()` returns:
 *
 * - macOS:   `~/Library/Application Support/<identifier>/`
 * - Windows: `%APPDATA%\<identifier>\`
 * - Linux:   `$XDG_DATA_HOME/<identifier>/` (falling back to `~/.local/share`)
 *
 * Rust normally computes this path and passes it through `DATABASE_URL`; this
 * function only matters when the compiled binary is started by hand.
 */
export function getAppDataDir(): string {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", APP_IDENTIFIER);
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_IDENTIFIER);
    default: {
      const dataHome = process.env.XDG_DATA_HOME?.trim();
      return join(dataHome && dataHome.length > 0 ? dataHome : join(homedir(), ".local", "share"), APP_IDENTIFIER);
    }
  }
}

/** Absolute path of `database.db` inside the app data folder. */
export function getDatabasePath(): string {
  return join(getAppDataDir(), DATABASE_FILENAME);
}

/** Absolute path of `audit.db` inside the app data folder. */
export function getAuditDatabasePath(): string {
  return join(getAppDataDir(), AUDIT_DATABASE_FILENAME);
}

/**
 * Turn a `DATABASE_URL` value into a filesystem path.
 *
 * Rust passes `file:<dir>/database.db`; `:memory:` and bare paths are accepted
 * too. Values are taken verbatim (not URL-decoded) because Rust builds them
 * from a filesystem path rather than from a percent-encoded URL.
 */
export function databaseUrlToPath(url: string): string {
  if (url === ":memory:" || !url.startsWith("file:")) return url;
  const raw = url.slice("file:".length);
  if (!raw.startsWith("//")) return raw;
  return new URL(url).pathname;
}

/** `DATABASE_URL` from the environment, or the app data default. */
export function resolveDatabasePath(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL?.trim();
  return url ? databaseUrlToPath(url) : getDatabasePath();
}

/**
 * `AUDIT_DATABASE_URL` when set, otherwise `audit.db` beside the business
 * database. Keeping the two files in the same folder means a backup or a test
 * cleanup only has to handle one directory.
 */
export function resolveAuditDatabasePath(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.AUDIT_DATABASE_URL?.trim();
  if (explicit) return databaseUrlToPath(explicit);

  const businessPath = resolveDatabasePath(env);
  if (businessPath === ":memory:") return ":memory:";
  return join(dirname(businessPath), AUDIT_DATABASE_FILENAME);
}

/** Create the folder that holds the database. No-op for in-memory databases. */
export function ensureDatabaseDir(databasePath: string): void {
  if (databasePath === ":memory:") return;
  mkdirSync(dirname(databasePath), { recursive: true });
}
