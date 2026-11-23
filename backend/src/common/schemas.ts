import { z } from "zod";
import { ApiErrorSchema } from "./apiResponse";

/**
 * Zod schemas that describe this API's request and response bodies.
 *
 * The response schemas are not decoration: `createDocApp()` validates every 2xx
 * JSON body against them (a mismatch is logged and answered `500`) and generates
 * the OpenAPI document at `/api-docs.json` from them. Keep them in sync with
 * `prisma/schema.prisma`.
 */

/**
 * A Zod object's fields as `field: type` strings, for `@Payload(...)`.
 *
 * The flow graph documents the payload a client actually sends, so deriving it
 * from the schema the route validates against keeps the two from drifting:
 *
 * ```ts
 * @Payload(payloadOf(CreateFolderBodySchema))
 * export class CreateFolderCommand extends Command<Folder> { … }
 * ```
 *
 * Optional fields are marked `field?`; nested objects read as `object` — give
 * `@Payload(fields, dtos)` an explicit DTO entry when a nested shape matters.
 */
export function payloadOf(schema: z.ZodObject<Record<string, z.ZodType>>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, field] of Object.entries(schema.shape)) {
    const optional = field.type === "optional";
    fields[optional ? `${name}?` : name] = zodTypeName(optional ? unwrapZod(field) : field);
  }
  return fields;
}

/** The inner type of an `optional`/`nullable` wrapper. */
function unwrapZod(field: z.ZodType): z.ZodType {
  return (field as unknown as { unwrap: () => z.ZodType }).unwrap();
}

/** One Zod field as a TypeScript-ish type name. */
function zodTypeName(field: z.ZodType): string {
  switch (field.type) {
    case "optional":
      return `${zodTypeName(unwrapZod(field))} | undefined`;
    case "nullable":
      return `${zodTypeName(unwrapZod(field))} | null`;
    case "array":
      return `${zodTypeName((field as unknown as { element: z.ZodType }).element)}[]`;
    case "number":
    case "bigint":
      return "number";
    case "string":
    case "date":
      return "string";
    case "boolean":
      return "boolean";
    case "literal":
      return typeof (field as unknown as { value: unknown }).value === "number" ? "number" : "string";
    case "enum":
      return "enum";
    case "object":
      return "object";
    default:
      return field.type;
  }
}

/** This API's error envelope, as produced by `src/http.ts`. */
export const ErrorResponse = ApiErrorSchema;

/** Every row stores `created_at` as unix epoch milliseconds, written by the API. */
const epochMillis = () => z.number().describe("Unix epoch milliseconds");

// ── Responses ─────────────────────────────────────────────────────────────

export const FocusableStripSchema = z.object({
  id: z.number().int(),
  pdf_document_id: z.number().int().describe("The document this strip belongs to"),
  folder_id: z.number().int().nullable().describe("The folder it sits in, null when it is in none"),
  ordering: z.number().int().describe("Position among the folder's strips, 0 first"),
  page_number: z.number().int().describe("1-based page number, same as data-page"),
  top: z.number().describe("Top edge in PDF points, so zoom does not change it"),
  height: z.number(),
  left: z.number(),
  width: z.number(),
  page_width: z.number(),
  page_height: z.number(),
  text_excerpt: z.string().nullable().describe("First ~200 chars of the selection"),
  remark: z.string().describe("Markdown note, empty when there is none"),
  created_at: epochMillis(),
});

export const FolderSchema = z.object({
  id: z.number().int(),
  pdf_document_id: z.number().int(),
  name: z.string(),
  ordering: z.number().int().describe("Position among the document's folders, 0 first"),
  created_at: epochMillis(),
});

/** `GET /folders` returns each folder with its strips in drag order. */
export const FolderWithStripsSchema = FolderSchema.extend({
  focusable_strips: z.array(FocusableStripSchema),
});

export const PdfDocumentSchema = z.object({
  id: z.number().int(),
  name: z.string().describe("Editable display name"),
  file_path: z.string(),
  fingerprint: z.string().nullable().describe("pdf.js fingerprint of the file, recorded when it is opened"),
  page_count: z.number().int().nullable(),
  content_hash: z
    .string()
    .nullable()
    .describe("sha256 of the PDF; null for documents not yet copied into the library"),
  original_path: z.string().nullable().describe("Where the PDF was imported from"),
  ordering: z.number().int().describe("Position in the notes document list, 0 first"),
  created_at: epochMillis(),
});

/** `POST /pdf-documents/resolve` returns the document with every strip. */
export const PdfDocumentWithStripsSchema = PdfDocumentSchema.extend({
  focusable_strips: z.array(FocusableStripSchema),
});

/** `GET /pdf-documents` adds the strip count for the list. */
export const PdfDocumentWithCountSchema = PdfDocumentSchema.extend({
  _count: z.object({ focusable_strips: z.number().int() }),
});

/** The one settings row. A null column has never been written. */
export const AppStateSchema = z.object({
  id: z.number().int(),
  notes_panel_width: z.number().int().nullable(),
  event_log_panel_width: z.number().int().nullable(),
  notes_documents_width: z.number().int().nullable(),
  last_opened_pdf_document_id: z.number().int().nullable(),
  updated_at: z.number(),
});

/** `PATCH /app-state` writes only the columns it names. */
export const UpdateAppStateBodySchema = z.object({
  notes_panel_width: z.number().int().min(1).max(10_000).optional(),
  event_log_panel_width: z.number().int().min(1).max(10_000).optional(),
  notes_documents_width: z.number().int().min(1).max(10_000).optional(),
  last_opened_pdf_document_id: z.number().int().min(1).nullable().optional(),
});

export const FocusableStripWithDocumentSchema = FocusableStripSchema.extend({
  pdf_document: z.object({
    id: z.number().int(),
    name: z.string(),
    file_path: z.string(),
  }),
});

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  pid: z.number().int(),
  uptimeSeconds: z.number().int(),
});

// ── Requests ──────────────────────────────────────────────────────────────

export const ResolveDocumentBodySchema = z.object({
  file_path: z.string().trim().min(1).max(4096).describe("Absolute path of the PDF"),
  name: z.string().trim().max(512).optional().describe("Ignored on update unless update_name is true"),
  fingerprint: z.string().trim().max(512).optional(),
  page_count: z.number().int().min(0).optional(),
  update_name: z.boolean().optional().describe("Overwrite a name the user edited"),
});

export const RenameDocumentBodySchema = z.object({
  name: z.string().trim().min(1).max(512),
});

/**
 * `POST /pdf-documents/import`: the app's own copies of the PDFs the reader picked.
 *
 * `name` only matters when one path is sent and that document is new; an
 * existing row keeps the name the reader may have edited. Several paths each
 * take the file's own name.
 */
export const ImportDocumentBodySchema = z.object({
  source_paths: z
    .array(z.string().trim().min(1).max(4096))
    .min(1)
    .describe("Absolute paths of the PDFs to open"),
  name: z
    .string()
    .trim()
    .max(512)
    .optional()
    .describe("Used only when one path is sent and that document is new"),
});

export const CreateStripBodySchema = z.object({
  pdf_document_id: z.number().int().min(1),
  /**
   * Omit to append the strip to the document's first folder. A document with
   * no folders gets one named "Notes" for this save.
   */
  folder_id: z.number().int().min(1).optional(),
  page_number: z.number().int().min(1),
  top: z.number().min(0),
  height: z.number().gt(0),
  left: z.number().min(0),
  width: z.number().gt(0),
  page_width: z.number().gt(0),
  page_height: z.number().gt(0),
  text_excerpt: z.string().max(2000).optional(),
  remark: z.string().max(100_000).optional(),
});

export const CreateFolderBodySchema = z.object({
  pdf_document_id: z.number().int().min(1),
  name: z.string().trim().min(1).max(512),
});

export const RenameFolderBodySchema = z.object({
  name: z.string().trim().min(1).max(512),
});

export const FoldersQuerySchema = z.object({
  pdf_document_id: z.coerce.number().int().min(1).describe("Folders of this document"),
});

/** `with_strips=true` also deletes the strips the folder holds. */
export const DeleteFolderQuerySchema = z.object({
  with_strips: z
    .enum(["true", "false"])
    .optional()
    .describe("Also delete the folder's strips; without it a non-empty folder answers 409"),
});

/** Every document, in the order the notes list should now show them. */
export const ReorderPdfDocumentsBodySchema = z.object({
  document_ids: z.array(z.number().int().min(1)).min(1),
});

/** The document's folders, in the order they should now appear. */
export const ReorderFoldersBodySchema = z.object({
  pdf_document_id: z.number().int().min(1),
  folder_ids: z.array(z.number().int().min(1)).min(1),
});

/**
 * One entry per folder whose membership or order changed. `strip_ids` is that
 * folder's full list after the drag, including an empty list when the last
 * strip was moved out.
 */
export const ReorderStripsBodySchema = z.object({
  groups: z
    .array(
      z.object({
        folder_id: z.number().int().min(1).nullable().describe("The group's folder, null for the strips in no folder"),
        strip_ids: z.array(z.number().int().min(1)),
      }),
    )
    .min(1),
});

/**
 * `PATCH /focusable-strips/:id`: the band's geometry when it was resized, the
 * card's remark when it was edited, or both.
 *
 * Every field is optional and the router writes only the ones it is given, so
 * moving a strip never has to resend its note and saving a note never has to
 * resend the geometry. `text_excerpt` is nullable because a band dragged onto a
 * gap between paragraphs covers no text at all.
 */
export const UpdateStripBodySchema = z.object({
  page_number: z.number().int().min(1).optional(),
  top: z.number().min(0).optional(),
  height: z.number().gt(0).optional(),
  left: z.number().min(0).optional(),
  width: z.number().gt(0).optional(),
  page_width: z.number().gt(0).optional(),
  page_height: z.number().gt(0).optional(),
  text_excerpt: z
    .string()
    .max(2000)
    .nullable()
    .optional()
    .describe("First ~200 chars of the band's text; null when it covers none"),
  remark: z.string().max(100_000).optional().describe("Markdown note; empty string clears it"),
});

export const FocusableStripsQuerySchema = z.object({
  pdf_document_id: z.coerce.number().int().min(1).optional().describe("Only strips of this document"),
  page_number: z.coerce.number().int().min(1).optional().describe("Only strips on this page"),
  unfiled: z.enum(["true", "false"]).optional().describe("Only the strips that are in no folder"),
});

/** One persisted command/event audit row, exposed by GET /event-audit. */
export const AuditEventSchema = z.object({
  id: z.number().int(),
  requestId: z.string(),
  eventType: z.string(),
  payload: z.string(),
  eventOrder: z.number().int(),
  requestUserEmail: z.string().nullable(),
  success: z.boolean(),
  failureReason: z.string(),
  createdAt: z.number(),
});

export const AuditEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  requestId: z.string().trim().optional(),
  eventType: z.string().trim().optional(),
  success: z.enum(["true", "false"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

export const AuditEventsResponseSchema = z.object({
  events: z.array(AuditEventSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
