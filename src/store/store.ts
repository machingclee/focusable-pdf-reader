import { configureStore } from "@reduxjs/toolkit";
import appSlice from "./slices/appSlice";
import { baseApi } from "./api/baseApi";
import { crossWindowSync } from "./crossWindowSync";
import { broadcastInvalidate } from "../windowBridge";

/**
 * App-wide store. `baseApi`'s reducer holds the query cache and its middleware
 * is what enables caching, invalidation, polling and refetching.
 *
 * Each webview evaluates this module for itself, so the pop-out notes window has
 * its own store and its own cache. `crossWindowSync` is what keeps the two from
 * drifting: a mutation in one window forwards its tag invalidations to the other.
 *
 * Unlike the generic scaffold this store has no localStorage write-through:
 * the only credential here is the per-launch backend token, which must not
 * outlive the process that generated it.
 */
export const store = configureStore({
  reducer: {
    app: appSlice.reducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      baseApi.middleware,
      crossWindowSync((types) => void broadcastInvalidate(types)),
    ),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
