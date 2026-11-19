import express from "express";
import type { AppPrisma } from "./db.ts";
import { errorHandler, notFoundHandler } from "./http.ts";
import { allowTauriOrigins, requireBackendToken } from "./middleware.ts";
import { createFocusableStripsRouter } from "./routes/focusableStrips.ts";
import { createHealthRouter } from "./routes/health.ts";
import { createPdfDocumentsRouter } from "./routes/pdfDocuments.ts";

/**
 * Build the HTTP API. Separate from `src/index.ts` so tests can mount the app
 * without binding a port.
 */
export function createApp({ prisma }: { prisma: AppPrisma }) {
  const app = express();

  app.disable("x-powered-by");
  app.use(allowTauriOrigins());
  app.use(requireBackendToken());
  app.use(express.json({ limit: "2mb" }));

  app.use("/health", createHealthRouter());
  app.use("/pdf-documents", createPdfDocumentsRouter(prisma));
  app.use("/focusable-strips", createFocusableStripsRouter(prisma));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export type App = ReturnType<typeof createApp>;
