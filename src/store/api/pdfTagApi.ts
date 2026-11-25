import type { PdfTag, PdfTagFolder } from "../../types/dto";
import { baseApi } from "./baseApi";

/**
 * `/pdf-tags` as RTK Query endpoints: the tag catalogue, and the folders that
 * group it.
 *
 * Assignment is not here: it belongs to a document, so `assignPdfTags` and
 * `unassignPdfTags` live in `pdfDocumentApi`. Writes invalidate the document
 * list whenever the catalogue changes what a rail row shows — a rename, a move,
 * or a delete — because the rows embed the tags.
 */
export const pdfTagApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listPdfTags: builder.query<PdfTag[], void>({
      query: () => "/pdf-tags",
      providesTags: [{ type: "PdfTag", id: "LIST" }],
    }),

    createPdfTag: builder.mutation<PdfTag, { name: string; pdf_tag_folder_id?: number | null }>({
      query: (body) => ({ url: "/pdf-tags", method: "POST", body }),
      invalidatesTags: [{ type: "PdfTag", id: "LIST" }],
    }),

    /** Rename a tag and/or move it between folders (`null` = Ungrouped). */
    updatePdfTag: builder.mutation<
      PdfTag,
      { id: number; name?: string; pdf_tag_folder_id?: number | null }
    >({
      query: ({ id, ...body }) => ({ url: `/pdf-tags/${id}`, method: "PATCH", body }),
      invalidatesTags: [
        { type: "PdfTag", id: "LIST" },
        { type: "PdfDocument", id: "LIST" },
      ],
    }),

    deletePdfTag: builder.mutation<void, number>({
      query: (id) => ({ url: `/pdf-tags/${id}`, method: "DELETE" }),
      invalidatesTags: [
        { type: "PdfTag", id: "LIST" },
        { type: "PdfDocument", id: "LIST" },
      ],
    }),

    listPdfTagFolders: builder.query<PdfTagFolder[], void>({
      query: () => "/pdf-tags/folders",
      providesTags: [{ type: "PdfTagFolder", id: "LIST" }],
    }),

    createPdfTagFolder: builder.mutation<PdfTagFolder, { name: string }>({
      query: (body) => ({ url: "/pdf-tags/folders", method: "POST", body }),
      invalidatesTags: [{ type: "PdfTagFolder", id: "LIST" }],
    }),

    renamePdfTagFolder: builder.mutation<PdfTagFolder, { id: number; name: string }>({
      query: ({ id, name }) => ({
        url: `/pdf-tags/folders/${id}`,
        method: "PATCH",
        body: { name },
      }),
      invalidatesTags: [{ type: "PdfTagFolder", id: "LIST" }],
    }),

    /** Deleting a folder keeps its tags; their order in the rows changes, so both lists refetch. */
    deletePdfTagFolder: builder.mutation<void, number>({
      query: (id) => ({ url: `/pdf-tags/folders/${id}`, method: "DELETE" }),
      invalidatesTags: [
        { type: "PdfTagFolder", id: "LIST" },
        { type: "PdfTag", id: "LIST" },
        { type: "PdfDocument", id: "LIST" },
      ],
    }),

    /**
     * Apply a drag of the tag-folder list.
     *
     * The order is patched into the cache before the request returns, the same
     * way the notes folder drag is, so the row does not jump back mid-flight.
     */
    reorderPdfTagFolders: builder.mutation<PdfTagFolder[], { pdf_tag_folder_ids: number[] }>({
      query: (body) => ({ url: "/pdf-tags/folders/reorder", method: "POST", body }),
      invalidatesTags: [
        { type: "PdfTagFolder", id: "LIST" },
        { type: "PdfTag", id: "LIST" },
        { type: "PdfDocument", id: "LIST" },
      ],
      async onQueryStarted({ pdf_tag_folder_ids }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          pdfTagApi.util.updateQueryData("listPdfTagFolders", undefined, (draft) => {
            const byId = new Map(draft.map((folder) => [folder.id, folder]));
            const next = pdf_tag_folder_ids.flatMap((id, ordering) => {
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
  }),
});
