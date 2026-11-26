import type { NoteFolder, NoteFolderWithNotes } from "../../types/dto";
import { baseApi } from "./baseApi";

/**
 * `/note-folders` as RTK Query endpoints.
 *
 * The notes list subscribes to `listFolders`. Reordering patches that cache
 * immediately and lets the tag refetch confirm it, so the row does not jump
 * back to the old position while the request is in flight.
 */
export const noteFolderApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listFolders: builder.query<NoteFolderWithNotes[], { pdf_document_id: number }>({
      query: ({ pdf_document_id }) => ({ url: "/note-folders", params: { pdf_document_id } }),
      providesTags: (result) => [
        { type: "NoteFolder", id: "LIST" },
        ...(result ?? []).map((folder) => ({ type: "NoteFolder" as const, id: folder.id })),
      ],
    }),

    createFolder: builder.mutation<NoteFolder, { pdf_document_id: number; name: string }>({
      query: (body) => ({ url: "/note-folders", method: "POST", body }),
      invalidatesTags: [{ type: "NoteFolder", id: "LIST" }],
    }),

    renameFolder: builder.mutation<NoteFolder, { id: number; name: string }>({
      query: ({ id, name }) => ({ url: `/note-folders/${id}`, method: "PATCH", body: { name } }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: "NoteFolder", id: "LIST" },
        { type: "NoteFolder", id },
      ],
    }),

    /**
     * Deleting an empty folder needs only its id. `with_strips` is the caller
     * saying it has looked at what the folder holds and wants it gone with the
     * folder — the backend refuses a non-empty folder without it.
     */
    deleteFolder: builder.mutation<void, { id: number; with_strips?: boolean }>({
      query: ({ id, with_strips }) => ({
        url: `/note-folders/${id}`,
        method: "DELETE",
        ...(with_strips ? { params: { with_strips: true } } : {}),
      }),
      // The strips go with the folder, so their list and the documents' strip
      // counts go stale as well. An empty folder changes neither. The strip tag
      // is the whole type rather than the list: a `[note:<id>]` reference holds
      // one strip by id, and those strips are gone too.
      invalidatesTags: (_result, _error, { with_strips }) => [
        { type: "NoteFolder", id: "LIST" },
        ...(with_strips
          ? [
              { type: "Note" as const },
              { type: "PdfDocument" as const, id: "LIST" },
            ]
          : []),
      ],
    }),

    reorderFolders: builder.mutation<NoteFolderWithNotes[], { pdf_document_id: number; note_folder_ids: number[] }>({
      query: (body) => ({ url: "/note-folders/reorder", method: "POST", body }),
      invalidatesTags: [{ type: "NoteFolder", id: "LIST" }],
      async onQueryStarted({ pdf_document_id, note_folder_ids }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          noteFolderApi.util.updateQueryData("listFolders", { pdf_document_id }, (draft) => {
            const byId = new Map(draft.map((folder) => [folder.id, folder]));
            const next = note_folder_ids.flatMap((id, ordering) => {
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
