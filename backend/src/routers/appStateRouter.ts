import { createDocRouter } from "../docs/routeRegistry.ts";
import { UpdateAppStateCommand } from "../bounded-contexts/pdf-note-management/command/UpdateAppStateCommand.ts";
import { GetAppStateQuery } from "../bounded-contexts/pdf-note-management/query/GetAppStateQuery.ts";
import { AppStateSchema, UpdateAppStateBodySchema, ErrorResponse } from "../common/schemas.ts";

/**
 * `/app-state` — the one settings row.
 *
 * Each column is one remembered value (`notes_panel_width`, the width of the
 * Notes-of-this-PDF column). A patch writes the columns it names and leaves
 * the others. `last_opened_pdf_document_id` is written when a document is
 * resolved, by `PdfPolicy`, except when that resolve opened it in a new window.
 */
export const appStateRouter = createDocRouter("/app-state");

/** The settings row. Columns that have never been written are null. */
appStateRouter.get(
  "/",
  {
    responseSchema: AppStateSchema,
    summary: "Read the remembered UI state",
    tags: ["app-state"],
  },
  async (req, res) => {
    res.json(await req.queryBus.send(new GetAppStateQuery()));
  },
);

/** Patch one or more columns of the settings row. */
appStateRouter.patch(
  "/",
  {
    bodySchema: UpdateAppStateBodySchema,
    responseSchema: AppStateSchema,
    summary: "Update remembered UI state",
    tags: ["app-state"],
    responses: {
      400: { description: "Invalid body", schema: ErrorResponse },
      404: { description: "No such document for last_opened_pdf_document_id", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new UpdateAppStateCommand(req.body)));
  },
);
