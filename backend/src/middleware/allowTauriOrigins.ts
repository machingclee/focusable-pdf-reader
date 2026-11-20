import type { RequestHandler } from "express";

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
      // PUT is used by `PUT /app-state/:key`; keep this list in step with the
      // routers, or the webview's preflight rejects the request before it is sent.
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
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
