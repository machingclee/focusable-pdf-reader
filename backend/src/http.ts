import type { NextFunction, Request, RequestHandler, Response } from "express";

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

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const notFound = (message = "Not found") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const unauthorized = (message = "Unauthorized") => new HttpError(401, message);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The request body, guaranteed to be a JSON object. */
export function bodyObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw badRequest("Request body must be a JSON object");
  return value;
}

export function requireString(body: Record<string, unknown>, key: string, maxLength = 4096): string {
  const value = body[key];
  if (typeof value !== "string") throw badRequest(`"${key}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw badRequest(`"${key}" must not be empty`);
  if (trimmed.length > maxLength) throw badRequest(`"${key}" must be at most ${maxLength} characters`);
  return trimmed;
}

export function optionalString(body: Record<string, unknown>, key: string, maxLength = 4096): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badRequest(`"${key}" must be a string when provided`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw badRequest(`"${key}" must be at most ${maxLength} characters`);
  return trimmed;
}

export function requireFiniteNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw badRequest(`"${key}" must be a finite number`);
  return value;
}

export function requireInteger(body: Record<string, unknown>, key: string, min = 1): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw badRequest(`"${key}" must be an integer >= ${min}`);
  }
  return value;
}

export function optionalPositiveInteger(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw badRequest(`"${key}" must be a non-negative integer when provided`);
  }
  return value;
}

/** Route params arrive as strings; ids are positive integers. */
export function parseIdParam(raw: string | undefined, name = "id"): number {
  if (!raw || !/^\d+$/.test(raw)) throw badRequest(`"${name}" must be a positive integer`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) throw badRequest(`"${name}" must be a positive integer`);
  return value;
}

/** Optional query-string integer. */
export function parseOptionalQueryInt(raw: unknown, name: string): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw badRequest(`"${name}" must be a positive integer`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) throw badRequest(`"${name}" must be a positive integer`);
  return value;
}

type PrismaLikeError = { code?: string; meta?: unknown };

function prismaErrorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof (error as PrismaLikeError).code === "string"
    ? (error as PrismaLikeError).code
    : undefined;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};

export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, ...(error.details === undefined ? {} : { details: error.details }) });
    return;
  }

  // Malformed JSON body from express.json().
  if (error instanceof SyntaxError && isRecord(error) && "body" in error) {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }

  switch (prismaErrorCode(error)) {
    case "P2025": // record to update/delete not found
      res.status(404).json({ error: "Not found" });
      return;
    case "P2002": // unique constraint
      res.status(409).json({ error: "Already exists" });
      return;
    case "P2003": // foreign key constraint
      res.status(409).json({ error: "Related record does not exist" });
      return;
    default:
      break;
  }

  console.error("[backend] unhandled error:", error);
  res.status(500).json({ error: "Internal server error" });
}
