import { baseApi } from "./baseApi";

export type HistoryStatus = {
  label: string;
  canUndo: boolean;
  canRedo: boolean;
};

/**
 * `POST /history/undo` and `POST /history/redo`.
 *
 * Either one can change a document, a folder or a strip, so every list refreshes.
 * An empty stack is a 409; the shortcut treats that as a quiet no-op.
 */
export const historyApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    undo: builder.mutation<HistoryStatus, void>({
      query: () => ({ url: "/history/undo", method: "POST" }),
      invalidatesTags: [
        { type: "PdfDocument", id: "LIST" },
        { type: "Folder", id: "LIST" },
        { type: "FocusableStrip", id: "LIST" },
      ],
    }),
    redo: builder.mutation<HistoryStatus, void>({
      query: () => ({ url: "/history/redo", method: "POST" }),
      invalidatesTags: [
        { type: "PdfDocument", id: "LIST" },
        { type: "Folder", id: "LIST" },
        { type: "FocusableStrip", id: "LIST" },
      ],
    }),
  }),
});
