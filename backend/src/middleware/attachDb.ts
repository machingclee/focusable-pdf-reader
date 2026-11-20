import type { RequestHandler } from "express";
import type { AppPrisma } from "../db.ts";
import { prisma } from "../prismaInstance.ts";

declare global {
  namespace Express {
    interface Request {
      /** The process-wide Prisma client; set by `attachDb()`. */
      db: AppPrisma;
    }
  }
}

/**
 * Puts the shared Prisma client on every request as `req.db`.
 *
 * Handlers no longer import the client themselves, so a router only has to say
 * what it needs through the type on `req`. The client is still created lazily:
 * this middleware calls the getter, which returns the cached instance after the
 * first request.
 *
 * Mount it before any router that touches the database, and after the token
 * check so a rejected request never opens the database.
 */
export function attachDb(): RequestHandler {
  return (req, _res, next) => {
    req.db = prisma();
    next();
  };
}
