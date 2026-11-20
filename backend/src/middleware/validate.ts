import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { z } from "zod";

/**
 * Request-body validation middleware.
 *
 * Parses `req.body` against the given Zod schema. On failure it answers `400`
 * in this API's error envelope (`{ error, details }`, see `src/http.ts`) so the
 * frontend's `ApiError` keeps surfacing a useful message. On success it
 * replaces `req.body` with the parsed data, so downstream handlers are typed.
 *
 * `createDocApp()` applies this automatically when a route sets `bodySchema`.
 */
export function validate(schema: z.ZodType): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

export default validate;
