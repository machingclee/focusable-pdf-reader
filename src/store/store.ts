import { configureStore } from "@reduxjs/toolkit";
import appSlice from "./slices/appSlice";
import { baseApi } from "./api/baseApi";

/**
 * App-wide store. `baseApi`'s reducer holds the query cache and its middleware
 * is what enables caching, invalidation, polling and refetching.
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
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
