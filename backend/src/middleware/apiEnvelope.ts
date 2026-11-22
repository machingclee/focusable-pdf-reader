import type { RequestHandler } from "express";
import { ApiResponse, ApiResponseSchema } from "../common/apiResponse.ts";

/**
 * Wraps every JSON response in the API envelope.
 *
 * Route handlers continue to return their domain payload. Errors that reach
 * `res.json` as raw `{ error }` objects are normalized to `errorMessage`.
 * `setupSwagger` opts out for the raw OpenAPI document.
 */
export function apiEnvelope(): RequestHandler {
  return (_req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: unknown) {
      if (res.locals.skipApiEnvelope) return originalJson(body);

      const status = res.statusCode || 200;
      let envelope: unknown;

      if (body instanceof ApiResponse) {
        envelope = body.toJSON();
      } else if (status >= 200 && status < 400) {
        envelope = ApiResponse.ok(body).toJSON();
      } else {
        envelope = ApiResponse.fail(errorMessageFrom(body)).toJSON();
      }

      const parsed = ApiResponseSchema.safeParse(envelope);
      if (!parsed.success) {
        console.error("[api] response does not match the API envelope:", parsed.error.issues);
        res.status(500);
        return originalJson(ApiResponse.fail("Internal server error").toJSON());
      }

      return originalJson(parsed.data);
    } as typeof res.json;

    next();
  };
}

function errorMessageFrom(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.errorMessage === "string") return record.errorMessage;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return "Request failed";
}
