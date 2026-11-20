import type { FocusableStrip, FolderWithStrips, NewStripInput, StripFilter } from "../../types/dto";
import { baseApi } from "./baseApi";
import { folderApi } from "./folderApi";

/**
 * `/focusable-strips` as RTK Query endpoints.
 *
 * Every mutation invalidates the strip list rather than returning the updated
 * array: the notes tab, the docked panel and the strip list are separate
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

    updateStripRemark: builder.mutation<FocusableStrip, { id: number; remark: string }>({
      query: ({ id, remark }) => ({
        url: `/focusable-strips/${id}`,
        method: "PATCH",
        body: { remark },
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: "FocusableStrip", id: "LIST" },
        { type: "FocusableStrip", id },
        // The notes list reads the remark off the folder query.
        { type: "Folder", id: "LIST" },
      ],
    }),

    /**
     * The strip's id is the whole input: `DELETE /focusable-strips/:id` needs
     * nothing else, and the list tag is what refreshes every host.
     */
    deleteStrip: builder.mutation<void, number>({
      query: (id) => ({ url: `/focusable-strips/${id}`, method: "DELETE" }),
      invalidatesTags: [
        { type: "FocusableStrip", id: "LIST" },
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
