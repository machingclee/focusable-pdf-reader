import { createDocRouter } from "../docs/routeRegistry.ts";
import { ErrorResponse, HealthResponseSchema } from "../common/schemas.ts";

/** Liveness probe the Rust side and the frontend can call. */
export const healthRouter = createDocRouter("/health");

healthRouter.get(
  "/",
  {
    responseSchema: HealthResponseSchema,
    summary: "Liveness probe",
    tags: ["health"],
    responses: { 500: { description: "Internal server error", schema: ErrorResponse } },
  },
  (_req, res) => {
    res.json({
      status: "ok",
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
    });
  },
);
