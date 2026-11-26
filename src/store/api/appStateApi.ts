import { baseApi } from "./baseApi";
import type { AppState, UpdateAppStateInput } from "../../types/dto";

/**
 * `/app-state` is one settings row. A patch names the columns it changes, and
 * invalidates the row so a later read sees them.
 *
 * `last_opened_pdf_document_id` is written by the backend when a document is
 * resolved in the window the reader was already in. A resolve from "Open PDF
 * in new window" leaves it unchanged. The viewer only patches the docked
 * column widths.
 */
export const appStateApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAppState: builder.query<AppState, void>({
      query: () => "/app-state",
      providesTags: [{ type: "AppState", id: "MAP" }],
    }),

    updateAppState: builder.mutation<AppState, UpdateAppStateInput>({
      query: (body) => ({
        url: "/app-state",
        method: "PATCH",
        body,
      }),
      invalidatesTags: [{ type: "AppState", id: "MAP" }],
    }),
  }),
});
