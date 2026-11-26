import type {
  Note,
  NoteWithDocument,
  NoteFolderWithNotes,
  NewStripInput,
  StripFilter,
  UpdateStripInput,
} from "../../types/dto";
import { baseApi } from "./baseApi";
import { noteFolderApi } from "./noteFolderApi";

/**
 * `/notes` as RTK Query endpoints.
 *
 * Every mutation invalidates the strip list rather than returning the updated
 * array: the Dashboard tab, the docked panel and the strip list are separate
 * subscribers to the same query, and one tag is what makes them all refresh
 * without any of them being handed the others' data.
 */
export const noteApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listStrips: builder.query<Note[], StripFilter | void>({
      query: (filter) => ({
        url: "/notes",
        params: filter?.pdf_document_id == null ? undefined : filter,
      }),
      providesTags: (result) => [
        { type: "Note", id: "LIST" },
        ...(result ?? []).map((strip) => ({ type: "Note" as const, id: strip.id })),
      ],
    }),

    /**
     * One strip, for the nested card a `[note:<id>]` reference renders.
     *
     * Its own query rather than a lookup in the list: the reference can point at
     * a strip in another document, whose list is not loaded here at all. The
     * per-id tag is the one the list and the mutations already use, so a note
     * edited anywhere refreshes every card that points at it.
     */
    getStrip: builder.query<NoteWithDocument, number>({
      query: (id) => ({ url: `/notes/${id}` }),
      providesTags: (_result, _error, id) => [{ type: "Note", id }],
    }),

    createStrip: builder.mutation<Note, NewStripInput>({
      query: (body) => ({ url: "/notes", method: "POST", body }),
      invalidatesTags: (_result, _error, { pdf_document_id }) => [
        { type: "Note", id: "LIST" },
        { type: "NoteFolder", id: "LIST" },
        // A new strip changes the document's strip count.
        { type: "PdfDocument", id: pdf_document_id },
        { type: "PdfDocument", id: "LIST" },
      ],
    }),

    /**
     * Write back to an existing strip: the band's new geometry after a resize,
     * the card's rewritten remark, or both. One endpoint because it is one row —
     * the body carries only the fields that changed.
     */
    updateStrip: builder.mutation<Note, UpdateStripInput>({
      query: ({ id, ...body }) => ({
        url: `/notes/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (result, _error, { id, highlights }) => [
        { type: "Note", id: "LIST" },
        { type: "Note", id },
        // The notes list reads the remark off the folder query.
        { type: "NoteFolder", id: "LIST" },
        // Marks live on the document, so a preview write refreshes the page too.
        ...(highlights !== undefined && result
          ? [{ type: "PdfDocument" as const, id: result.pdf_document_id }]
          : []),
      ],
    }),

    /**
     * The strip's id is the whole input: `DELETE /notes/:id` needs
     * nothing else, and the list tag is what refreshes every host.
     */
    deleteStrip: builder.mutation<void, number>({
      query: (id) => ({ url: `/notes/${id}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, id) => [
        { type: "Note", id: "LIST" },
        // Any `[note:<id>]` reference to this strip has to learn it is gone.
        { type: "Note", id },
        { type: "NoteFolder", id: "LIST" },
        // Strip counts live on the documents, so their list goes stale too.
        { type: "PdfDocument", id: "LIST" },
      ],
    }),

    /**
     * The new membership of every folder the drag touched. The notes list is
     * the folder query, so the cache is patched before the refetch lands and
     * rolled back if the backend rejects the order.
     */
    reorderStrips: builder.mutation<
      NoteFolderWithNotes[],
      { pdf_document_id: number; groups: { note_folder_id: number | null; note_ids: number[] }[] }
    >({
      query: ({ groups }) => ({ url: "/notes/reorder", method: "POST", body: { groups } }),
      invalidatesTags: [
        { type: "NoteFolder", id: "LIST" },
        { type: "Note", id: "LIST" },
      ],
      async onQueryStarted({ pdf_document_id, groups }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          noteFolderApi.util.updateQueryData("listFolders", { pdf_document_id }, (draft) => {
            const copies = new Map<number, Note>();
            for (const folder of draft) {
              for (const strip of folder.notes) copies.set(strip.id, { ...strip });
            }
            for (const group of groups) {
              // "No folder" has no entry in this cache, so those strips simply
              // leave the folders; the unfiled query picks them up when the tag
              // invalidation refetches it.
              if (group.note_folder_id === null) {
                for (const folder of draft) {
                  folder.notes = folder.notes.filter(
                    (strip) => !group.note_ids.includes(strip.id),
                  );
                }
                continue;
              }
              const folder = draft.find((item) => item.id === group.note_folder_id);
              if (!folder) continue;
              folder.notes = group.note_ids.flatMap((id, ordering) => {
                const strip = copies.get(id);
                if (!strip) return [];
                return [{ ...strip, note_folder_id: group.note_folder_id, ordering }];
              });
            }
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
