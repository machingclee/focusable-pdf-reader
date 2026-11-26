import type { PdfDocumentFolder } from "../../types/dto";
import { baseApi } from "./baseApi";

/**
 * `/pdf-document-folders` as RTK Query endpoints.
 *
 * A document with no membership is Ungrouped, which is not a row here. Assigning
 * adds a membership and leaves every other folder alone.
 */
export const pdfDocumentFolderApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listPdfDocumentFolders: builder.query<PdfDocumentFolder[], void>({
      query: () => "/pdf-document-folders",
      providesTags: [{ type: "PdfDocumentFolder", id: "LIST" }],
    }),

    createPdfDocumentFolder: builder.mutation<PdfDocumentFolder, { name: string }>({
      query: (body) => ({ url: "/pdf-document-folders", method: "POST", body }),
      invalidatesTags: [{ type: "PdfDocumentFolder", id: "LIST" }],
    }),

    renamePdfDocumentFolder: builder.mutation<PdfDocumentFolder, { id: number; name: string }>({
      query: ({ id, name }) => ({
        url: `/pdf-document-folders/${id}`,
        method: "PATCH",
        body: { name },
      }),
      invalidatesTags: [{ type: "PdfDocumentFolder", id: "LIST" }],
    }),

    deletePdfDocumentFolder: builder.mutation<void, number>({
      query: (id) => ({ url: `/pdf-document-folders/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "PdfDocumentFolder", id: "LIST" }],
    }),

    /**
     * Apply a drag of the document-folder list.
     *
     * The order is patched into the cache before the request returns, so each
     * folder stays where it was dropped instead of jumping back mid-flight.
     */
    reorderPdfDocumentFolders: builder.mutation<PdfDocumentFolder[], { pdf_document_folder_ids: number[] }>({
      query: (body) => ({ url: "/pdf-document-folders/reorder", method: "POST", body }),
      invalidatesTags: [{ type: "PdfDocumentFolder", id: "LIST" }],
      async onQueryStarted({ pdf_document_folder_ids }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          pdfDocumentFolderApi.util.updateQueryData("listPdfDocumentFolders", undefined, (draft) => {
            const byId = new Map(draft.map((folder) => [folder.id, folder]));
            const next = pdf_document_folder_ids.flatMap((id, ordering) => {
              const folder = byId.get(id);
              if (!folder) return [];
              folder.ordering = ordering;
              return [folder];
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
     * File documents into a folder.
     *
     * The new ids are appended before the request returns, so a PDF dropped on
     * a folder shows up there at once and leaves Ungrouped if that was its only
     * place. A refusal puts the list back.
     */
    assignPdfDocumentsToFolder: builder.mutation<
      PdfDocumentFolder,
      { id: number; pdf_document_ids: number[] }
    >({
      query: ({ id, pdf_document_ids }) => ({
        url: `/pdf-document-folders/${id}/documents`,
        method: "POST",
        body: { pdf_document_ids },
      }),
      invalidatesTags: [{ type: "PdfDocumentFolder", id: "LIST" }],
      async onQueryStarted({ id, pdf_document_ids }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          pdfDocumentFolderApi.util.updateQueryData("listPdfDocumentFolders", undefined, (draft) => {
            const folder = draft.find((item) => item.id === id);
            if (!folder) return;
            const have = new Set(folder.pdf_document_ids);
            const added = pdf_document_ids.filter((documentId) => !have.has(documentId));
            if (added.length === 0) return;
            folder.pdf_document_ids.push(...added);
            folder.document_count = folder.pdf_document_ids.length;
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
     * Take documents out of one folder.
     *
     * Those ids leave the folder's list immediately. If it was their last
     * membership they are Ungrouped again; a refusal restores the membership.
     */
    removePdfDocumentsFromFolder: builder.mutation<
      PdfDocumentFolder,
      { id: number; pdf_document_ids: number[] }
    >({
      query: ({ id, pdf_document_ids }) => ({
        url: `/pdf-document-folders/${id}/documents`,
        method: "DELETE",
        body: { pdf_document_ids },
      }),
      invalidatesTags: [{ type: "PdfDocumentFolder", id: "LIST" }],
      async onQueryStarted({ id, pdf_document_ids }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          pdfDocumentFolderApi.util.updateQueryData("listPdfDocumentFolders", undefined, (draft) => {
            const folder = draft.find((item) => item.id === id);
            if (!folder) return;
            const drop = new Set(pdf_document_ids);
            folder.pdf_document_ids = folder.pdf_document_ids.filter((documentId) => !drop.has(documentId));
            folder.document_count = folder.pdf_document_ids.length;
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
     * Apply a drag of the PDFs inside one folder.
     *
     * Each id is written into that folder's order before the request returns,
     * so the row that was dropped does not jump back while the write is in flight.
     */
    reorderPdfDocumentFolderMembers: builder.mutation<
      PdfDocumentFolder,
      { id: number; pdf_document_ids: number[] }
    >({
      query: ({ id, pdf_document_ids }) => ({
        url: `/pdf-document-folders/${id}/documents/reorder`,
        method: "POST",
        body: { pdf_document_ids },
      }),
      invalidatesTags: [{ type: "PdfDocumentFolder", id: "LIST" }],
      async onQueryStarted({ id, pdf_document_ids }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          pdfDocumentFolderApi.util.updateQueryData("listPdfDocumentFolders", undefined, (draft) => {
            const folder = draft.find((item) => item.id === id);
            if (!folder) return;
            folder.pdf_document_ids = pdf_document_ids;
            folder.document_count = pdf_document_ids.length;
          }),
        );
        try {
          await queryFulfilled;
        } catch {
          patch.undo();
        }
      },
    }),
  }),
});
