import type {
  FocusableStrip,
  FocusableStripWithDocument,
  FolderWithStrips,
  NewStripInput,
  StripFilter,
  UpdateStripInput,
} from "../../types/dto";
import { baseApi } from "./baseApi";
import { folderApi } from "./folderApi";

/**
 * `/focusable-strips` as RTK Query endpoints.
 *
 * Every mutation invalidates the strip list rather than returning the updated
 * array: the Dashboard tab, the docked panel and the strip list are separate
 * subscribers to the same query, and one tag is what makes them all refresh
 * without any of them being handed the others' data.
 */
export const focusableStripApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listStrips: builder.query<FocusableStrip[], StripFilter | void>({
      query: (filter) => ({
        url: "/focusable-strips",
        params: filter?.pdf_document_id == null ? undefined : filter,
      }),
      providesTags: (result) => [
        { type: "FocusableStrip", id: "LIST" },
        ...(result ?? []).map((strip) => ({ type: "FocusableStrip" as const, id: strip.id })),
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
    getStrip: builder.query<FocusableStripWithDocument, number>({
      query: (id) => ({ url: `/focusable-strips/${id}` }),
      providesTags: (_result, _error, id) => [{ type: "FocusableStrip", id }],
    }),

    createStrip: builder.mutation<FocusableStrip, NewStripInput>({
      query: (body) => ({ url: "/focusable-strips", method: "POST", body }),
      invalidatesTags: (_result, _error, { pdf_document_id }) => [
        { type: "FocusableStrip", id: "LIST" },
        { type: "Folder", id: "LIST" },
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
    updateStrip: builder.mutation<FocusableStrip, UpdateStripInput>({
      query: ({ id, ...body }) => ({
        url: `/focusable-strips/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (result, _error, { id, highlights }) => [
        { type: "FocusableStrip", id: "LIST" },
        { type: "FocusableStrip", id },
        // The notes list reads the remark off the folder query.
        { type: "Folder", id: "LIST" },
        // Marks live on the document, so a preview write refreshes the page too.
        ...(highlights !== undefined && result
          ? [{ type: "PdfDocument" as const, id: result.pdf_document_id }]
          : []),
      ],
    }),

    /**
     * The strip's id is the whole input: `DELETE /focusable-strips/:id` needs
     * nothing else, and the list tag is what refreshes every host.
     */
    deleteStrip: builder.mutation<void, number>({
      query: (id) => ({ url: `/focusable-strips/${id}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, id) => [
        { type: "FocusableStrip", id: "LIST" },
        // Any `[note:<id>]` reference to this strip has to learn it is gone.
        { type: "FocusableStrip", id },
        { type: "Folder", id: "LIST" },
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
      FolderWithStrips[],
      { pdf_document_id: number; groups: { folder_id: number | null; strip_ids: number[] }[] }
    >({
      query: ({ groups }) => ({ url: "/focusable-strips/reorder", method: "POST", body: { groups } }),
      invalidatesTags: [
        { type: "Folder", id: "LIST" },
        { type: "FocusableStrip", id: "LIST" },
      ],
      async onQueryStarted({ pdf_document_id, groups }, { dispatch, queryFulfilled }) {
        const patch = dispatch(
          folderApi.util.updateQueryData("listFolders", { pdf_document_id }, (draft) => {
            const copies = new Map<number, FocusableStrip>();
            for (const folder of draft) {
              for (const strip of folder.focusable_strips) copies.set(strip.id, { ...strip });
            }
            for (const group of groups) {
              // "No folder" has no entry in this cache, so those strips simply
              // leave the folders; the unfiled query picks them up when the tag
              // invalidation refetches it.
              if (group.folder_id === null) {
                for (const folder of draft) {
                  folder.focusable_strips = folder.focusable_strips.filter(
                    (strip) => !group.strip_ids.includes(strip.id),
                  );
                }
                continue;
              }
              const folder = draft.find((item) => item.id === group.folder_id);
              if (!folder) continue;
              folder.focusable_strips = group.strip_ids.flatMap((id, ordering) => {
                const strip = copies.get(id);
                if (!strip) return [];
                return [{ ...strip, folder_id: group.folder_id, ordering }];
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
