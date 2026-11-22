import { z } from "zod";

/** The JSON body returned by every API route. */
export type ApiResponseBody<T = unknown> = {
  success: boolean;
  data?: T;
  errorMessage?: string;
};

/** Runtime guard for the envelope itself. */
export const ApiResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.unknown().optional(),
    errorMessage: z.string().optional(),
  })
  .strict()
  .describe("Every API JSON response");

/** Success envelope whose `data` is checked against the route payload schema. */
export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z
    .object({
      success: z.literal(true),
      data,
      errorMessage: z.string().optional(),
    })
    .strict()
    .describe("Successful API response");
}

/** Failure envelope used by error handlers and documented error responses. */
export const ApiErrorSchema = z
  .object({
    success: z.literal(false),
    data: z.unknown().optional(),
    errorMessage: z.string(),
  })
  .strict()
  .describe("Failed API response");

/**
 * Small helper for constructing the envelope in application code.
 *
 * Routes keep returning their domain payload; the DocApp boundary wraps it.
 * Error handlers use `ApiResponse.fail(...)` so the message survives the
 * boundary as `errorMessage`.
 */
export class ApiResponse<T = unknown> {
  private constructor(
    readonly success: boolean,
    readonly data?: T,
    readonly errorMessage?: string,
  ) {}

  static ok<T>(data: T): ApiResponse<T> {
    return new ApiResponse(true, data);
  }

  static fail(message: string, data?: unknown): ApiResponse<unknown> {
    return new ApiResponse(false, data, message);
  }

  toJSON(): ApiResponseBody<T> {
    return {
      success: this.success,
      ...(this.data === undefined ? {} : { data: this.data }),
      ...(this.errorMessage === undefined ? {} : { errorMessage: this.errorMessage }),
    };
  }
}
