import express from "express";
import { createDocApp, setupSwagger } from "./docs/routeRegistry.ts";
import { errorHandler, notFoundHandler } from "./common/http.ts";
import { allowTauriOrigins } from "./middleware/allowTauriOrigins.ts";
import {
    attachCqrs,
    registerEventStorming,
} from "@machingclee/express-cqrs";
import { createDocRouter } from "./docs/routeRegistry.ts";
import { requireBackendToken } from "./middleware/requireBackendToken.ts";
import { notesRouter } from "./routers/notesRouter.ts";
import { noteFoldersRouter } from "./routers/noteFoldersRouter.ts";
import { healthRouter } from "./routers/healthRouter.ts";
import { appStateRouter } from "./routers/appStateRouter.ts";
import { pdfDocumentRouter } from "./routers/pdfDocumentRouter.ts";
import { pdfDocumentFolderRouter } from "./routers/pdfDocumentFolderRouter.ts";
import { pdfTagRouter } from "./routers/pdfTagRouter.ts";
import { eventAuditRouter } from "./routers/eventAuditRouter.ts";
import { historyRouter } from "./routers/historyRouter.ts";

/** Title and version shown by the Swagger UI at `/api-docs`. */
const API_TITLE = "PDF Focus Viewer API";
const API_VERSION = "0.1.0";

/**
 * Shown at the top of the Swagger UI. The diagram is the one thing in this API
 * that is a page rather than JSON, so the link at the top is how you get to it
 * without reading the docs first.
 */
const API_DESCRIPTION =
    "The command/query/event graph is served as JSON at `GET /docs/commands` " +
    "and drawn as a diagram at **[the event-storming page](/event-storming/)**.";


export const app = createDocApp();

app.disable("x-powered-by");
app.use(allowTauriOrigins());
app.use(express.json({ limit: "2mb" }));

// The docs stay readable without the launch token: a browser cannot send
// `X-Backend-Token` when a page fetches its own assets, and the event-storming
// page is opened in the user's browser, where the token Rust generated is not
// available at all. So every `/docs` route — `command-flow` (where the page
// lives) and `commands` (the graph it draws) — is exempt, like `/api-docs`
// itself, which already publishes the whole API surface. Both only describe the
// API; nothing behind them reads the database, and the data routes below stay
// token-protected.
app.use(requireBackendToken({
    skip: [/^\/api-docs/, /^\/event-storming/, /^\/docs\//],
}));

// Every route below gets the request context and the buses on `req`; attaching
// after the token check means a rejected request never opens the database.
app.use(attachCqrs());

app.use("/health", healthRouter);
app.use("/pdf-documents", pdfDocumentRouter);
app.use("/pdf-document-folders", pdfDocumentFolderRouter);
app.use("/pdf-tags", pdfTagRouter);
app.use("/note-folders", noteFoldersRouter);
app.use("/notes", notesRouter);
app.use("/app-state", appStateRouter);
app.use("/event-audit", eventAuditRouter);
app.use("/history", historyRouter);

const eventStormingDocs = createDocRouter("/docs");

registerEventStorming(app, {
    registerRoute: (path, config, handler) => {
        eventStormingDocs.get(path, config as never, handler);
    },
});

app.use("/docs", eventStormingDocs);

// Must come after every route (the document is built eagerly) and before the
// not-found handler (it registers `/api-docs` itself).
setupSwagger(app, { title: API_TITLE, version: API_VERSION, description: API_DESCRIPTION });

app.use(notFoundHandler);
app.use(errorHandler);

export type App = typeof app;
