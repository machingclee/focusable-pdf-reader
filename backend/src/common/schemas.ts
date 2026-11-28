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
 * @Payload(payloadOf(CreateNoteFolderBodySchema))
 * export class CreateNoteFolderCommand extends Command<NoteFolder> { … }
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

export const NoteSchema = z.object({
  id: z.number().int(),
  pdf_document_id: z.number().int().describe("The document this strip belongs to"),
  note_folder_id: z.number().int().nullable().describe("The folder it sits in, null when it is in none"),
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
  expanded: z
    .boolean()
    .describe("Whether the writing under the preview is shown. New notes start open"),
  highlights: z
    .string()
    .describe("JSON list of the document's marks on this strip's page, { x0, x1, y, size }; [] when that page is unmarked"),
  annotations: z
    .string()
    .describe("JSON list of the document's annotations on this strip's page, { id, x, y, text }; [] when that page has none"),
  created_at: epochMillis(),
});

export const NoteFolderSchema = z.object({
  id: z.number().int(),
  pdf_document_id: z.number().int(),
  name: z.string(),
  ordering: z.number().int().describe("Position among the document's folders, 0 first"),
  created_at: epochMillis(),
});

/** `GET /note-folders` returns each folder with its strips in drag order. */
export const NoteFolderWithNotesSchema = NoteFolderSchema.extend({
  notes: z.array(NoteSchema),
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
export const PdfDocumentWithNotesSchema = PdfDocumentSchema.extend({
  notes: z.array(NoteSchema),
});

/** One tag on a document, as the document list carries it. */
export const DocumentTagSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  pdf_tag_folder_id: z.number().int().nullable().describe("The tag folder, null when ungrouped"),
});

/** `GET /pdf-documents` adds the strip count and the document's tags for the list. */
export const PdfDocumentWithCountSchema = PdfDocumentSchema.extend({
  _count: z.object({ notes: z.number().int() }),
  tags: z.array(DocumentTagSchema),
});

/** A folder that groups tags; it is not the notes `folder`. */
export const PdfTagFolderSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  ordering: z.number().int().describe("Position among the tag folders, 0 first"),
  created_at: epochMillis(),
});

/** A tag in the catalogue, with how many documents carry it. */
export const PdfTagSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  pdf_tag_folder_id: z.number().int().nullable().describe("The tag folder, null when ungrouped"),
  created_at: epochMillis(),
  document_count: z.number().int().describe("Assignments that still point at this tag"),
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

export const NoteWithDocumentSchema = NoteSchema.extend({
  pdf_document: z.object({
    id: z.number().int(),
    name: z.string(),
    file_path: z.string(),
  }),
});

/**
 * One text pin on a page of a document, in PDF points.
 *
 * `x` and `y` are the pin's top-left corner, `y` from the top of that page, so
 * it stays on its words at any zoom. The row has an id because a note's markdown
 * points at it: `[annotation:<id>]`.
 */
export const AnnotationSchema = z.object({
  id: z.number().int(),
  pdf_document_id: z.number().int().describe("The document this annotation belongs to"),
  page_number: z.number().int().describe("1-based page number, same as data-page"),
  x: z.number().describe("Left edge of the pin in PDF points"),
  y: z.number().describe("Top edge of the pin in PDF points, from the top of the page"),
  width: z.number().describe("Width of the content in PDF points; the reader drags its edge"),
  font_size: z
    .number()
    .describe("Type size of the writing in PDF points; the reader takes it up and down"),
  text: z.string().describe("Markdown: the annotation's writing"),
  created_at: epochMillis(),
});

/** One annotation with the document it belongs to, for a `[annotation:<id>]` reference. */
export const AnnotationWithDocumentSchema = AnnotationSchema.extend({
  pdf_document: z.object({
    id: z.number().int(),
    name: z.string(),
    file_path: z.string(),
  }),
});

/** The document's annotations, as `GET /pdf-documents/:id/annotations` answers. */
export const DocumentAnnotationsSchema = z.object({
  annotations: z.array(AnnotationSchema).describe("Every pin on every page, oldest first"),
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
  /**
   * The documents column's "Open PDF in new window". That window resolves the
   * same document so it can show it, and that resolve must not become
   * `last_opened_pdf_document_id`. Absent means this is the window the app
   * should remember.
   */
  in_new_window: z
    .boolean()
    .optional()
    .describe("A window of its own: do not remember this document as the last opened"),
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
  note_folder_id: z.number().int().min(1).optional(),
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

export const CreateNoteFolderBodySchema = z.object({
  pdf_document_id: z.number().int().min(1),
  name: z.string().trim().min(1).max(512),
});

export const RenameNoteFolderBodySchema = z.object({
  name: z.string().trim().min(1).max(512),
});

export const FoldersQuerySchema = z.object({
  pdf_document_id: z.coerce.number().int().min(1).describe("Folders of this document"),
});

/** A tag folder's name: trimmed, 1..64 characters. */
export const CreatePdfTagFolderBodySchema = z.object({
  name: z.string().trim().min(1).max(64),
});

export const RenamePdfTagFolderBodySchema = z.object({
  name: z.string().trim().min(1).max(64),
});

/** The tag folders, in the order they should now appear. */
export const ReorderPdfTagFoldersBodySchema = z.object({
  pdf_tag_folder_ids: z.array(z.number().int().min(1)).min(1),
});

/** A folder that groups documents. Not a note folder and not a tag folder. */
export const PdfDocumentFolderSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  ordering: z.number().int().describe("Position among the document folders, 0 first"),
  created_at: epochMillis(),
  pdf_document_ids: z.array(z.number().int()).describe("Documents in this folder, in drag order"),
  document_count: z.number().int().describe("Memberships this folder still holds"),
});

/** A document folder's name: trimmed, 1..64 characters. */
export const CreatePdfDocumentFolderBodySchema = z.object({
  name: z.string().trim().min(1).max(64),
});

export const RenamePdfDocumentFolderBodySchema = z.object({
  name: z.string().trim().min(1).max(64),
});

/** The document folders, in the order they should now appear. */
export const ReorderPdfDocumentFoldersBodySchema = z.object({
  pdf_document_folder_ids: z.array(z.number().int().min(1)).min(1),
});

/** Documents to file in one folder, take out of it, or reorder inside it. */
export const PdfDocumentFolderMembersBodySchema = z.object({
  pdf_document_ids: z.array(z.number().int().min(1)).min(1),
});

/**
 * File documents in one folder.
 *
 * `index` is where the new ids are inserted among the documents already there.
 * Omit it to append. A document that is already a member is skipped, and the
 * index counts only the new ones.
 */
export const AssignPdfDocumentsToFolderBodySchema = PdfDocumentFolderMembersBodySchema.extend({
  index: z.number().int().min(0).optional(),
});

/** A tag's name and, optionally, the folder it is filed under. */
export const CreatePdfTagBodySchema = z.object({
  name: z.string().trim().min(1).max(64),
  pdf_tag_folder_id: z.number().int().min(1).nullable().optional(),
});

/**
 * `PATCH /pdf-tags/:id` writes only the fields it is given.
 *
 * `pdf_tag_folder_id: null` moves the tag to Ungrouped; omitting it leaves the
 * folder alone, which is why the handler checks the key's presence rather than
 * its value.
 */
export const UpdatePdfTagBodySchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  pdf_tag_folder_id: z.number().int().min(1).nullable().optional(),
});

/** Tags to assign to, or unassign from, one document. */
export const AssignPdfTagsBodySchema = z.object({
  pdf_tag_ids: z
    .array(z.number().int().min(1))
    .min(1)
    .max(64)
    .describe("The tags this document should gain, or lose"),
});

/** The document a paste takes its tags from; the path names the one they go onto. */
export const CopyPdfTagsBodySchema = z.object({
  from_document_id: z
    .number()
    .int()
    .min(1)
    .describe("The document whose tags this one should carry instead"),
});

/** `with_strips=true` also deletes the strips the folder holds. */
export const DeleteNoteFolderQuerySchema = z.object({
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
export const ReorderNoteFoldersBodySchema = z.object({
  pdf_document_id: z.number().int().min(1),
  note_folder_ids: z.array(z.number().int().min(1)).min(1),
});

/**
 * One entry per folder whose membership or order changed. `note_ids` is that
 * folder's full list after the drag, including an empty list when the last
 * strip was moved out.
 */
export const ReorderStripsBodySchema = z.object({
  groups: z
    .array(
      z.object({
        note_folder_id: z.number().int().min(1).nullable().describe("The group's folder, null for the strips in no folder"),
        note_ids: z.array(z.number().int().min(1)),
      }),
    )
    .min(1),
});

/**
 * `PATCH /notes/:id`: the band's geometry when it was resized, the
 * card's remark when it was edited, the preview's highlights, whether the
 * writing under the preview is shown, or any of them.
 *
 * Every field is optional and the router writes only the ones it is given, so
 * moving a strip never has to resend its note and saving a note never has to
 * resend the geometry. `text_excerpt` is nullable because a band dragged onto a
 * gap between paragraphs covers no text at all. `highlights` is the whole list
 * of marks, replaced in one write.
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
  expanded: z
    .boolean()
    .optional()
    .describe("Show or hide the writing under the preview. The preview itself stays"),
  highlights: z
    .string()
    .max(100_000)
    .optional()
    .describe("JSON list of { x0, x1, y, size } in PDF points; replaces the preview's marks"),
});

/**
 * Whether `value` is a JSON list of preview marks.
 *
 * Each mark is a horizontal stroke in PDF points: `x0` and `x1` are the ends,
 * `y` is the top edge measured from the top of the page, and `size` is the
 * thickness. The preview paints exactly this list, so a write that is not the
 * list is refused rather than stored and then skipped at read time.
 */
export function isStripHighlightList(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length > 400) return false;
  return parsed.every((item) => {
    if (!item || typeof item !== "object") return false;
    const mark = item as Record<string, unknown>;
    return (
      finite(mark.x0) &&
      finite(mark.x1) &&
      finite(mark.y) &&
      typeof mark.size === "number" &&
      Number.isFinite(mark.size) &&
      mark.size > 0 &&
      mark.size <= 200
    );
  });
}

/** Whether `value` is the document's mark list: each stroke names its page. */
export function isDocumentHighlightList(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length > 800) return false;
  return parsed.every((item) => {
    if (!item || typeof item !== "object") return false;
    const mark = item as Record<string, unknown>;
    return (
      typeof mark.page === "number" &&
      Number.isInteger(mark.page) &&
      mark.page >= 1 &&
      finite(mark.x0) &&
      finite(mark.x1) &&
      finite(mark.y) &&
      typeof mark.size === "number" &&
      Number.isFinite(mark.size) &&
      mark.size > 0 &&
      mark.size <= 200
    );
  });
}

/**
 * `POST /pdf-documents/:id/annotations`: one pin.
 *
 * The text is trimmed and has to be something: a pin with no writing is a growth
 * on the page that cannot be read, referenced or searched. The page is checked
 * against the document's own `page_count` by the handler, which is what knows it.
 */
export const CreateAnnotationBodySchema = z.object({
  page_number: z.number().int().min(1).describe("1-based page number"),
  x: z.number().min(0).max(100_000).describe("Left edge in PDF points"),
  y: z.number().min(0).max(100_000).describe("Top edge in PDF points, from the top of the page"),
  width: z
    .number()
    .min(60)
    .max(1_200)
    .optional()
    .describe("Width of the content in PDF points; defaults to 150"),
  font_size: z
    .number()
    .min(5)
    .max(13)
    .optional()
    .describe("Type size of the writing in PDF points, 5-13 centred on the default 9"),
  text: z
    .string()
    .trim()
    .min(1)
    .max(10_000)
    .describe("The markdown to pin to the page"),
});

/**
 * `PATCH /annotations/:id`: one pin's writing, where it stands, or how big it is.
 *
 * A text edit names only the text. A move names the page and both coordinates,
 * because a pin is a point: half a placement is not a place, and a row left at a
 * stale `y` would draw the annotation somewhere nobody put it. The handler refuses
 * a placement that names only part of one. The type size is an edit of its own: it
 * changes how the writing reads, not where the pin stands.
 */
export const UpdateAnnotationBodySchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(10_000)
    .optional()
    .describe("The new writing, as markdown"),
  page_number: z.number().int().min(1).optional().describe("1-based page the pin now stands on"),
  x: z.number().min(0).max(100_000).optional().describe("Left edge in PDF points"),
  y: z.number().min(0).max(100_000).optional().describe("Top edge in PDF points, from the top of the page"),
  width: z
    .number()
    .min(60)
    .max(1_200)
    .optional()
    .describe("Width of the content in PDF points, for a content resize"),
  font_size: z
    .number()
    .min(5)
    .max(13)
    .optional()
    .describe("Type size of the writing in PDF points, 5-13 centred on the default 9"),
});

export const ReplacePdfHighlightsBodySchema = z.object({
  highlights: z
    .string()
    .max(200_000)
    .describe("JSON list of { page, x0, x1, y, size } in PDF points; replaces the document's marks"),
});

function finite(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

export const NotesQuerySchema = z.object({
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

/** What `POST /history/undo` and `POST /history/redo` answer with. */
export const HistoryStatusSchema = z.object({
  label: z.string(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});

export const AuditEventsResponseSchema = z.object({
  events: z.array(AuditEventSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
