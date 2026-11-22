import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiResponse } from "./apiResponse.ts";

/** An error carrying the HTTP status the API should answer with. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The only way errors are built: each member maps a failure kind to its status. */
export const ErrorFactory = {
  ofBadRequest: (message: string, details?: unknown) => new HttpError(400, message, details),
  ofNotFound: (message = "Not found") => new HttpError(404, message),
  ofConflict: (message: string) => new HttpError(409, message),
  ofUnauthorized: (message = "Unauthorized") => new HttpError(401, message),
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Request bodies are validated by the Zod schemas in `src/schemas.ts` (applied
// by `createDocApp` via `bodySchema`), so the hand-rolled body parsers that used
// to live here were removed rather than left as a second way to validate.

/** Route params arrive as strings; ids are positive integers. */
export function parseIdParam(raw: unknown, name = "id"): number {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw ErrorFactory.ofBadRequest(`"${name}" must be a positive integer`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) throw ErrorFactory.ofBadRequest(`"${name}" must be a positive integer`);
  return value;
}

/** Optional query-string integer. */
export function parseOptionalQueryInt(raw: unknown, name: string): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw ErrorFactory.ofBadRequest(`"${name}" must be a positive integer`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) throw ErrorFactory.ofBadRequest(`"${name}" must be a positive integer`);
  return value;
}

/**
 * Optional query-string flag. Only the literal words are accepted, so a typo in
 * a destructive call (`with_strips=1`) is refused rather than read as "true".
 */
export function parseOptionalQueryBoolean(raw: unknown, name: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw ErrorFactory.ofBadRequest(`"${name}" must be "true" or "false"`);
}

type PrismaLikeError = { code?: string; meta?: unknown };

function prismaErrorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof (error as PrismaLikeError).code === "string"
    ? (error as PrismaLikeError).code
    : undefined;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(ApiResponse.fail("Not found"));
};

export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json(ApiResponse.fail(error.message));
    return;
  }

  // Malformed JSON body from express.json().
  if (error instanceof SyntaxError && isRecord(error) && "body" in error) {
    res.status(400).json(ApiResponse.fail("Malformed JSON body"));
    return;
  }

  switch (prismaErrorCode(error)) {
    case "P2025": // record to update/delete not found
      res.status(404).json(ApiResponse.fail("Not found"));
      return;
    case "P2002": // unique constraint
      res.status(409).json(ApiResponse.fail("Already exists"));
      return;
    case "P2003": // foreign key constraint
      res.status(409).json(ApiResponse.fail("Related record does not exist"));
      return;
    default:
      break;
  }

  console.error("[backend] unhandled error:", error);
  res.status(500).json(ApiResponse.fail("Internal server error"));
}
