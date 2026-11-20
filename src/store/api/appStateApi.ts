import { baseApi } from "./baseApi";
import type { AppStateEntry } from "../../types/dto";

/**
 * `/app-state` as RTK Query endpoints: one row per remembered UI value.
 *
 * The value map is read by whichever component owns the piece of state it
 * remembers, and written through a mutation that invalidates the map, so a second
 * reader of the same key sees the new value without anyone passing it down.
 */
export const appStateApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAppState: builder.query<Record<string, string>, void>({
      query: () => "/app-state",
      providesTags: [{ type: "AppState", id: "MAP" }],
    }),

    setAppState: builder.mutation<AppStateEntry, { key: string; value: string }>({
      query: ({ key, value }) => ({
        url: `/app-state/${encodeURIComponent(key)}`,
        method: "PUT",
        body: { value },
      }),
      invalidatesTags: [{ type: "AppState", id: "MAP" }],
    }),
  }),
});
