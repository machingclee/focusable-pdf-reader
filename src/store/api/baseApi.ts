import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from "@reduxjs/toolkit/query/react";
import { broadcastCacheStale } from "../../windowBridge";
import { resolveBackendTarget } from "./targetOverride";
import { setBackend } from "../slices/appSlice";
import type { RootState } from "../store";

/* ── base URL ─────────────────────────────────────────────────
   `fetchBaseQuery` fixes its base URL when it is created, but this app only
   learns the backend address at runtime: in development it is
   `VITE_BACKEND_PORT`, in a packaged build Rust hands over the port the
   sidecar was given. So build the query lazily for the resolved address and
   reuse it — the port does not change during a session. */

let cachedBaseQuery: { baseUrl: string; query: ReturnType<typeof fetchBaseQuery> } | null = null;

function baseQueryFor(baseUrl: string): ReturnType<typeof fetchBaseQuery> {
  if (cachedBaseQuery?.baseUrl === baseUrl) return cachedBaseQuery.query;

  const query = fetchBaseQuery({
    baseUrl,
    // Unlike the generic scaffold this reads the token from Redux state rather
    // than localStorage: the token is generated per launch and must not be
    // persisted. `baseQuery` below writes it into the store before every call.
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as RootState).app.backendToken;
      if (token) headers.set("X-Backend-Token", token);
      return headers;
    },
  });

  cachedBaseQuery = { baseUrl, query };
  return query;
}

/* ── base query ───────────────────────────────────────────────
   Resolves the backend address, mirrors it into the store, then delegates to
   the query bound to that address. If Rust cannot report a port yet (the
   sidecar is still starting, or it died) the failure becomes a normal query
   error instead of an unhandled rejection. */

export const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  let target;
  try {
    target = await resolveBackendTarget();
  } catch (error) {
    return {
      error: {
        status: "CUSTOM_ERROR",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const state = api.getState() as RootState;
  if (state.app.backendBaseUrl !== target.baseUrl || state.app.backendToken !== target.token) {
    api.dispatch(setBackend(target));
  }

  const result = await baseQueryFor(target.baseUrl)(args, api, extraOptions);

  // The backend wraps every JSON response in { success, data?, errorMessage? }.
  // Unwrap successful payloads so endpoints keep their domain return types.
  if ("data" in result && result.data && typeof result.data === "object") {
    const envelope = result.data as {
      success?: unknown;
      data?: unknown;
      errorMessage?: unknown;
    };
    if (envelope.success === true) return { data: envelope.data };
    if (envelope.success === false) {
      return {
        error: {
          status: "CUSTOM_ERROR",
          error:
            typeof envelope.errorMessage === "string"
              ? envelope.errorMessage
              : "Request failed",
        },
      };
    }
  }

  return result;
};

/**
 * Human-readable message for a query/mutation error.
 *
 * HTTP failures arrive as `error.data` containing the API envelope, so the
 * message is `{ success: false, errorMessage }`. Keeps that shape in one place.
 */
export function apiErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;

  const status = (error as { status?: unknown }).status;
  if (status === "CUSTOM_ERROR") {
    const message = (error as { error?: unknown }).error;
    return typeof message === "string" ? message : null;
  }
  if (status === "FETCH_ERROR") return "The backend is not reachable";

  const data = (error as { data?: unknown }).data;
  if (data && typeof data === "object") {
    const envelope = data as { errorMessage?: unknown; error?: unknown };
    if (typeof envelope.errorMessage === "string") return envelope.errorMessage;
    if (typeof envelope.error === "string") return envelope.error;
  }

  // RTK's SerializedError (thrown exceptions) has `message` but no `status`.
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message.length > 0) return message;

  return status === undefined ? null : `Request failed (${String(status)})`;
}

/**
 * Whether a finished request should tell the other windows the backend changed.
 *
 * Only a **mutation**: a query is a read, even the `POST /pdf-documents/resolve`
 * upsert the notes column makes, and announcing reads would close a loop — one
 * window's invalidation makes the next window refetch, the refetch announces
 * itself, and the two windows keep each other busy forever.
 *
 * A failed request changed nothing, so it announces nothing.
 *
 * Kept a separate function because this is the whole rule, and a rule is worth a
 * test of its own.
 */
export function shouldAnnounceWrite(api: { type: "query" | "mutation" }, failed: boolean): boolean {
  return api.type === "mutation" && !failed;
}

/**
 * The backend address seam, plus the one thing the API layer owes the windows.
 *
 * Telling the other windows that their cache may be stale is a fact about the
 * API, not about the UI: what changed is backend state, and the thing that knows
 * a write landed is this response. Wired here it covers every endpoint, present
 * and future, without a list of which mutation touches which row — and it fires
 * for a write made in any window, which is the point, because each window has its
 * own cache.
 */
const baseQueryAnnouncingWrites: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const result = await baseQuery(args, api, extraOptions);
  if (shouldAnnounceWrite(api, "error" in result)) void broadcastCacheStale();
  return result;
};

/**
 * Every tag type the cache knows.
 *
 * One list, in one place, because two things have to agree on it: the API (a tag
 * an endpoint provides must be declared here) and the cross-window sync, which
 * invalidates every one of them in every window when any window writes
 * (`store/cacheStale.ts`). A new tag type is therefore covered by the other
 * windows the day it is added, instead of being remembered in a second list.
 */
export const ALL_TAG_TYPES = [
  "PdfDocument",
  "Folder",
  "FocusableStrip",
  "AppState",
  "PdfTag",
  "PdfTagFolder",
] as const;

export type TagType = (typeof ALL_TAG_TYPES)[number];

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: baseQueryAnnouncingWrites,
  // Shared tag types, so the injected slices can invalidate each other's data.
  tagTypes: ALL_TAG_TYPES,
  endpoints: () => ({}),
});
