import { configureStore } from "@reduxjs/toolkit";
import appSlice from "./slices/appSlice";
import viewerSlice from "./slices/viewerSlice";
import documentSlice from "./slices/documentSlice";
import panelsSlice from "./slices/panelsSlice";
import searchSlice from "./slices/searchSlice";
import { baseApi } from "./api/baseApi";

/**
 * App-wide store. `baseApi`'s reducer holds the query cache and its middleware
 * is what enables caching, invalidation, polling and refetching.
 *
 * Each webview evaluates this module for itself, so every window — the main one,
 * the popped-out notes column, and each viewer a note reference opens — has its
 * own store and its own cache. Keeping those in step is the API layer's business,
 * not the store's: a write that the backend accepted announces itself from the
 * base query (`api/baseApi.ts`), and each window answers with
 * `invalidateEveryTag` (`store/cacheStale.ts`) in the components that mount the
 * app.
 *
 * Unlike the generic scaffold this store has no localStorage write-through:
 * the only credential here is the per-launch backend token, which must not
 * outlive the process that generated it.
 */
export const store = configureStore({
  reducer: {
    app: appSlice.reducer,
    viewer: viewerSlice,
    document: documentSlice,
    panels: panelsSlice,
    search: searchSlice,
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
