import { ALL_TAG_TYPES, baseApi } from "./baseApi";

export type HistoryStatus = {
  label: string;
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * Every tag type, stale.
 *
 * A step can be about any row, and it cannot say which: the stack keeps the
 * command that replays it, not a description of what it touched. Invalidating
 * the `LIST` tags alone reaches the collections and misses everything that
 * carries one entity's own tag — the open document's marks (`getHighlights`
 * provides `PdfDocument[id]`) and a `[note:<id>]` card (`getStrip` provides
 * `FocusableStrip[id]`). Undoing a highlight then restored the rows and left
 * the page and the reading strip painting the stroke, and redo could not bring
 * one back, because the cache never heard about either.
 *
 * So this is the same answer the other windows give when one of them writes
 * (`store/cacheStale.ts`): mark the lot stale and let each subscriber refetch.
 * It is a local backend, and there are already per-document tags to refresh.
 */
const EVERY_TAG_TYPE = ALL_TAG_TYPES.map((type) => ({ type }));

/**
 * `POST /history/undo` and `POST /history/redo`.
 *
 * An empty stack is a 409; the shortcut treats that as a quiet no-op.
 */
export const historyApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    undo: builder.mutation<HistoryStatus, void>({
      query: () => ({ url: "/history/undo", method: "POST" }),
      invalidatesTags: EVERY_TAG_TYPE,
    }),
    redo: builder.mutation<HistoryStatus, void>({
      query: () => ({ url: "/history/redo", method: "POST" }),
      invalidatesTags: EVERY_TAG_TYPE,
    }),
  }),
});
