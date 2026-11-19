import { Router } from "express";

/** Liveness probe the Rust side and the frontend can call. */
export function createHealthRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      status: "ok",
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  return router;
}
