import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { unauthorized } from "./http.ts";

/**
 * Origins the Tauri webview can have, plus the Vite dev server.
 * Override with a comma-separated `ALLOWED_ORIGINS`.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
];

function allowedOrigins(): Set<string> {
  const configured = process.env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return new Set(configured && configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS);
}

/**
 * CORS for the Tauri webview origins only. Requests without an `Origin` header
 * (curl, the Tauri Rust side, the compiled binary's own health checks) pass
 * through untouched.
 */
export function allowTauriOrigins(): RequestHandler {
  const allowed = allowedOrigins();

  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Backend-Token");
      res.setHeader("Access-Control-Max-Age", "600");
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

function tokenMatches(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Optional shared secret. When Rust passes `BACKEND_TOKEN` at launch, every
 * request must carry it in `X-Backend-Token`, so other local programs cannot
 * drive the API. Without the variable the check is a no-op.
 */
export function requireBackendToken(): RequestHandler {
  const expected = process.env.BACKEND_TOKEN?.trim();
  if (!expected) return (_req, _res, next) => next();

  return (req, _res, next) => {
    const provided = req.get("x-backend-token")?.trim();
    if (!provided || !tokenMatches(provided, expected)) {
      next(unauthorized("Missing or invalid X-Backend-Token"));
      return;
    }
    next();
  };
}
