import { baseApi } from "./baseApi";
import type {
  ImportDocumentInput,
  PdfDocument,
  PdfDocumentListItem,
  PdfDocumentWithStrips,
  ResolveDocumentInput,
} from "../../types/dto";

/**
 * `/pdf-documents` as RTK Query endpoints.
 *
 * `getOrCreateDocument` is a query on purpose even though it is a POST: the
 * endpoint *is* an idempotent upsert (the backend keys on `file_path`), so
 * caching it per document means the viewer, the notes panel and a strip save all
 * share one round trip instead of re-resolving on every action.
 */
export const pdfDocumentApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listDocuments: builder.query<PdfDocumentListItem[], void>({
      query: () => "/pdf-documents",
      providesTags: (result) => [
        { type: "PdfDocument", id: "LIST" },
        ...(result ?? []).map((document) => ({ type: "PdfDocument" as const, id: document.id })),
      ],
    }),

    getOrCreateDocument: builder.query<PdfDocumentWithStrips, ResolveDocumentInput>({
      query: (body) => ({ url: "/pdf-documents/resolve", method: "POST", body }),
      providesTags: (result) =>
        result
          ? [
              { type: "PdfDocument", id: result.id },
              { type: "PdfDocument", id: "LIST" },
              { type: "FocusableStrip", id: "LIST" },
            ]
          : [{ type: "PdfDocument", id: "LIST" }],
    }),

    /**
     * Take a picked PDF into the app's library, once, and answer with the
     * document that now owns the copy.
     *
     * Every path-based way into the app goes through this rather than reading the
     * file the reader chose, which is what makes moving the original harmless.
     * The document list is invalidated because an import can create a row (and
     * because a legacy row's path changes when it is upgraded).
     */
    importDocument: builder.mutation<PdfDocumentWithStrips, ImportDocumentInput>({
      query: (body) => ({ url: "/pdf-documents/import", method: "POST", body }),
      invalidatesTags: [{ type: "PdfDocument", id: "LIST" }],
    }),

    renameDocument: builder.mutation<PdfDocument, { id: number; name: string }>({
      query: ({ id, name }) => ({ url: `/pdf-documents/${id}`, method: "PATCH", body: { name } }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: "PdfDocument", id },
        { type: "PdfDocument", id: "LIST" },
      ],
    }),
  }),
});
