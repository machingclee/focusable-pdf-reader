import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { DeletePdfAnnotationCommand } from "../bounded-contexts/pdf-markup-management/command/DeletePdfAnnotationCommand.ts";
import { UpdatePdfAnnotationCommand } from "../bounded-contexts/pdf-markup-management/command/UpdatePdfAnnotationCommand.ts";
import { GetPdfAnnotationQuery } from "../bounded-contexts/pdf-markup-management/query/GetPdfAnnotationQuery.ts";
import { parseIdParam } from "../common/http.ts";
import {
  AnnotationSchema,
  AnnotationWithDocumentSchema,
  ErrorResponse,
  UpdateAnnotationBodySchema,
} from "../common/schemas.ts";

/**
 * `/annotations` — one pin, addressed by its id.
 *
 * The create and the list belong to the document they mark
 * (`/pdf-documents/:id/annotations`), because the PDF is what owns them. What
 * lives here is everything a note does with a single row: a `[annotation:<id>]`
 * reference resolves against `GET /annotations/:id` — it may have been pasted
 * into a note of a completely different document — and the editor rewrites or
 * removes that one row.
 */
export const annotationsRouter = createDocRouter("/annotations");

/**
 * One annotation, with the document it belongs to.
 *
 * A reference has to be able to read the row by itself: the note it was pasted
 * into need not be about the same PDF, so nothing of that document is loaded.
 * A row that is gone answers 404, which the card draws as "was deleted".
 */
annotationsRouter.get(
  "/:id",
  {
    responseSchema: AnnotationWithDocumentSchema,
    summary: "Read one annotation, with the document it belongs to",
    tags: ["annotations"],
    responses: {
      400: { description: "Invalid id", schema: ErrorResponse },
      404: { description: "No such annotation", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.queryBus.send(new GetPdfAnnotationQuery(id)));
  },
);

/**
 * Change one pin: its text, or where it stands.
 *
 * A move names `page_number`, `x` and `y` together; a retype names only `text`.
 * One route for both because both are one row and one history step each.
 */
annotationsRouter.patch(
  "/:id",
  {
    bodySchema: UpdateAnnotationBodySchema,
    responseSchema: AnnotationSchema,
    summary: "Change the text of one annotation",
    tags: ["annotations"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No such annotation", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.commandBus.send(new UpdatePdfAnnotationCommand(id, req.body)));
  },
);

/** Remove one pin. Undo puts the same row back, under the same id. */
annotationsRouter.delete(
  "/:id",
  {
    summary: "Remove one annotation",
    tags: ["annotations"],
    responses: {
      204: { description: "Annotation deleted" },
      400: { description: "Invalid id", schema: ErrorResponse },
      404: { description: "No such annotation", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    await req.commandBus.send(new DeletePdfAnnotationCommand(id));
    res.status(204).end();
  },
);
