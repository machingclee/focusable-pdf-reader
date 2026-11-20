import type { Folder, FolderWithStrips } from "../../types/dto";
import { baseApi } from "./baseApi";

/**
 * `/folders` as RTK Query endpoints.
 *
 * The notes list subscribes to `listFolders`. Reordering patches that cache
 * immediately and lets the tag refetch confirm it, so the row does not jump
 * back to the old position while the request is in flight.
 */
export const folderApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listFolders: builder.query<FolderWithStrips[], { pdf_document_id: number }>({
      query: ({ pdf_document_id }) => ({ url: "/folders", params: { pdf_document_id } }),
      providesTags: (result) => [
        { type: "Folder", id: "LIST" },
        ...(result ?? []).map((folder) => ({ type: "Folder" as const, id: folder.id })),
      ],
    }),

    createFolder: builder.mutation<Folder, { pdf_document_id: number; name: string }>({
      query: (body) => ({ url: "/folders", method: "POST", body }),
      invalidatesTags: [{ type: "Folder", id: "LIST" }],
    }),

    renameFolder: builder.mutation<Folder, { id: number; name: string }>({
      query: ({ id, name }) => ({ url: `/folders/${id}`, method: "PATCH", body: { name } }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: "Folder", id: "LIST" },
        { type: "Folder", id },
      ],
    }),

    /**
     * Deleting an empty folder needs only its id. `with_strips` is the caller
     * saying it has looked at what the folder holds and wants it gone with the
     * folder — the backend refuses a non-empty folder without it.
     */
    deleteFolder: builder.mutation<void, { id: number; with_strips?: boolean }>({
      query: ({ id, with_strips }) => ({
        url: `/folders/${id}`,
        method: "DELETE",
        ...(with_strips ? { params: { with_strips: true } } : {}),
      }),
      // The strips go with the folder, so their list and the documents' strip
      // counts go stale as well. An empty folder changes neither.
      invalidatesTags: (_result, _error, { with_strips }) => [
        { type: "Folder", id: "LIST" },
        ...(with_strips
          ? [
              { type: "FocusableStrip" as const, id: "LIST" },
              { type: "PdfDocument" as const, id: "LIST" },
            ]
          : []),
      ],
    }),

    reorderFolders: builder.mutation<FolderWithStrips[], { pdf_document_id: number; folder_ids: number[] }>({
      query: (body) => ({ url: "/folders/reorder", method: "POST", body }),
      invalidatesTags: [{ type: "Folder", id: "LIST" }],
      async onQueryStarted({ pdf_document_id, folder_ids }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          folderApi.util.updateQueryData("listFolders", { pdf_document_id }, (draft) => {
            const byId = new Map(draft.map((folder) => [folder.id, folder]));
            const next = folder_ids.flatMap((id, ordering) => {
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
