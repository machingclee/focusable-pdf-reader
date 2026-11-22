import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { ErrorFactory } from "../common/http.ts";

function tokenMatches(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Optional shared secret. When Rust passes `BACKEND_TOKEN` at launch, every
 * request must carry it in `X-Backend-Token`, so other local programs cannot
 * drive the API. Without the variable the check is a no-op.
 *
 * `skip` exempts paths matched by the given patterns. The API docs use it: a
 * browser loading Swagger UI cannot attach the header to the UI's own asset
 * requests, and the document only describes the API rather than exposing data.
 */
export function requireBackendToken(opts: { skip?: RegExp[] } = {}): RequestHandler {
  const expected = process.env.BACKEND_TOKEN?.trim();
  if (!expected) return (_req, _res, next) => next();

  const skip = opts.skip ?? [];

  return (req, _res, next) => {
    if (skip.some((pattern) => pattern.test(req.path))) {
      next();
      return;
    }
    const provided = req.get("x-backend-token")?.trim();
    if (!provided || !tokenMatches(provided, expected)) {
      next(ErrorFactory.ofUnauthorized("Missing or invalid X-Backend-Token"));
      return;
    }
    next();
  };
}
