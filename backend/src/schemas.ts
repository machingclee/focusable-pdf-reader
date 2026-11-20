import { z } from "zod";

/**
 * Zod schemas that describe this API's request and response bodies.
 *
 * The response schemas are not decoration: `createDocApp()` validates every 2xx
 * JSON body against them (a mismatch is logged and answered `500`) and generates
 * the OpenAPI document at `/api-docs.json` from them. Keep them in sync with
 * `prisma/schema.prisma`.
 */

/** This API's error envelope, as produced by `src/http.ts`. */
export const ErrorResponse = z.object({
  error: z.string(),
  details: z.unknown().optional().describe("Field-level issues, when the error carries them"),
});

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
  fingerprint: z.string().nullable().describe("pdf.js fingerprint, used to re-link a moved file"),
  page_count: z.number().int().nullable(),
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

/** `GET /app-state` returns one flat key/value map of remembered UI state. */
export const AppStateMapSchema = z
  .record(z.string(), z.string())
  .describe("Remembered UI values, keyed by a dotted name");

export const SetAppStateBodySchema = z.object({
  value: z.string().max(10_000).describe("The value to remember under the key in the path"),
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

export const CreateStripBodySchema = z.object({
  pdf_document_id: z.number().int().min(1),
  /**
   * Omit to append the strip to the document's first folder. A document with
   * no folders gets one named "Strips" for this save.
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

export const UpdateStripRemarkBodySchema = z.object({
  remark: z.string().max(100_000).describe("Markdown note; empty string clears it"),
});

export const FocusableStripsQuerySchema = z.object({
  pdf_document_id: z.coerce.number().int().min(1).optional().describe("Only strips of this document"),
  page_number: z.coerce.number().int().min(1).optional().describe("Only strips on this page"),
  unfiled: z.enum(["true", "false"]).optional().describe("Only the strips that are in no folder"),
});
