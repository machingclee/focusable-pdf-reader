import express from "express";
import { createDocApp, setupSwagger } from "./docs/routeRegistry.ts";
import { errorHandler, notFoundHandler } from "./http.ts";
import { allowTauriOrigins } from "./middleware/allowTauriOrigins.ts";
import { attachDb } from "./middleware/attachDb.ts";
import { requireBackendToken } from "./middleware/requireBackendToken.ts";
import { focusableStripsRouter, FOCUSABLE_STRIPS_MOUNT } from "./routers/focusableStripsRouter.ts";
import { foldersRouter, FOLDERS_MOUNT } from "./routers/foldersRouter.ts";
import { healthRouter, HEALTH_MOUNT } from "./routers/healthRouter.ts";
import { appStateRouter, APP_STATE_MOUNT } from "./routers/appStateRouter.ts";
import { pdfDocumentRouter, PDF_DOCUMENTS_MOUNT } from "./routers/pdfDocumentRouter.ts";

/** Title and version shown by the Swagger UI at `/api-docs`. */
const API_TITLE = "PDF Focus Viewer API";
const API_VERSION = "0.1.0";


export const app = createDocApp();

app.disable("x-powered-by");
app.use(allowTauriOrigins());
app.use(express.json({ limit: "2mb" }));

// The docs stay readable without the launch token: a browser cannot send
// `X-Backend-Token` when Swagger UI fetches its own assets. The API is still
// token-protected, and the backend only listens on 127.0.0.1.
app.use(requireBackendToken({ skip: [/^\/api-docs/] }));

// Every route below gets `req.db`; attaching after the token check means a
// rejected request never opens the database.
app.use(attachDb());

app.use(HEALTH_MOUNT, healthRouter);
app.use(PDF_DOCUMENTS_MOUNT, pdfDocumentRouter);
app.use(FOLDERS_MOUNT, foldersRouter);
app.use(FOCUSABLE_STRIPS_MOUNT, focusableStripsRouter);
app.use(APP_STATE_MOUNT, appStateRouter);

// Must come after every route (the document is built eagerly) and before the
// not-found handler (it registers `/api-docs` itself).
setupSwagger(app, { title: API_TITLE, version: API_VERSION });

app.use(notFoundHandler);
app.use(errorHandler);

export type App = typeof app;
