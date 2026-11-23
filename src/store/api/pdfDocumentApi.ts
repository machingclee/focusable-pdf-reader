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
      // The list tag stays off this query on purpose. `/resolve` upserts a path
      // whose file is still there, so a subscriber that refetches when the
      // document list is invalidated would recreate a row the reader just
      // deleted. A path whose file is gone is a 404 and writes nothing.
      providesTags: (result) => (result ? [{ type: "PdfDocument", id: result.id }] : []),
    }),

    /**
     * Take picked PDFs into the app's library and answer with the documents
     * that now own the copies, in the same order as `source_paths`.
     *
     * Every path-based way into the app goes through this rather than reading the
     * file the reader chose, which is what makes moving the original harmless.
     * The document list is invalidated because an import can create a row (and
     * because a legacy row's path changes when it is upgraded).
     */
    importDocument: builder.mutation<PdfDocumentWithStrips[], ImportDocumentInput>({
      query: (body) => ({ url: "/pdf-documents/import", method: "POST", body }),
      invalidatesTags: [{ type: "PdfDocument", id: "LIST" }],
    }),

    /**
     * Apply a drag of the notes document list.
     *
     * The cache is patched before the request returns, the same way a folder
     * drag is, so the row does not jump back while the write is in flight.
     */
    reorderDocuments: builder.mutation<PdfDocumentListItem[], { document_ids: number[] }>({
      query: (body) => ({ url: "/pdf-documents/reorder", method: "POST", body }),
      invalidatesTags: [{ type: "PdfDocument", id: "LIST" }],
      async onQueryStarted({ document_ids }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          pdfDocumentApi.util.updateQueryData("listDocuments", undefined, (draft) => {
            const byId = new Map(draft.map((document) => [document.id, document]));
            const next = document_ids.flatMap((id, ordering) => {
              const document = byId.get(id);
              if (!document) return [];
              document.ordering = ordering;
              return [document];
            });
            draft.splice(0, draft.length, ...next);
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),

    /**
     * Remove the document from the library. Folders and strips go with the row,
     * so those lists are invalidated with the document list — the strip tag is
     * the whole type, because a `[note:<id>]` reference anywhere holds one of
     * those strips by id and has to learn it is gone. The row is taken out of
     * the cache before the refetch, and put back if the delete is refused.
     */
    deleteDocument: builder.mutation<void, number>({
      query: (id) => ({ url: `/pdf-documents/${id}`, method: "DELETE" }),
      invalidatesTags: [
        { type: "PdfDocument", id: "LIST" },
        { type: "Folder", id: "LIST" },
        { type: "FocusableStrip" },
      ],
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          pdfDocumentApi.util.updateQueryData("listDocuments", undefined, (draft) => {
            const index = draft.findIndex((document) => document.id === id);
            if (index >= 0) draft.splice(index, 1);
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),

    renameDocument: builder.mutation<PdfDocument, { id: number; name: string }>({
      query: ({ id, name }) => ({ url: `/pdf-documents/${id}/rename`, method: "PATCH", body: { name } }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: "PdfDocument", id },
        { type: "PdfDocument", id: "LIST" },
      ],
      // The list is what the Notes column is showing. Write the new name into it
      // as soon as the rename lands, so the row does not flash the old one while
      // the tag invalidation refetches.
      async onQueryStarted({ id, name }, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } catch {
          return;
        }
        dispatch(
          pdfDocumentApi.util.updateQueryData("listDocuments", undefined, (draft) => {
            const document = draft.find((item) => item.id === id);
            if (document) document.name = name;
          }),
        );
      },
    }),
  }),
});
