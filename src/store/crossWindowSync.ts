/**
 * Keeps the two windows' caches honest without sharing them.
 *
 * A mutation's *result* is only useful to the window that made it, but its
 * *invalidation* is useful to both: the notes window cannot know that the main
 * window renamed a strip, so the main window tells it what went stale.
 *
 * Tag **types** are forwarded rather than exact tags. Invalidating a type string
 * invalidates every tag of that type, so the price of never missing a subscriber
 * is a couple of extra GETs against a localhost backend.
 */
import type { Middleware } from "@reduxjs/toolkit";
import { baseApi } from "./api/baseApi";
import type { AppDispatch } from "./store";

/**
 * Which tag types each mutation can affect.
 *
 * A superset of the `invalidatesTags` in `src/store/api/*.ts` on purpose: the
 * conditional ones (`deleteFolder` with and without `with_strips`) always exist
 * here, because invalidating a type nobody is watching costs nothing while
 * missing one leaves a stale card on screen.
 *
 * `setAppState` is deliberately absent: the only key it writes is the docked
 * column's width, which is the main window's business.
 */
export const MUTATION_TAG_TYPES: Record<string, string[]> = {
  createStrip: ["FocusableStrip", "Folder", "PdfDocument"],
  updateStrip: ["FocusableStrip", "Folder", "PdfDocument"],
  deleteStrip: ["FocusableStrip", "Folder", "PdfDocument"],
  reorderStrips: ["FocusableStrip", "Folder"],
  createFolder: ["Folder"],
  renameFolder: ["Folder"],
  deleteFolder: ["Folder", "FocusableStrip", "PdfDocument"],
  reorderFolders: ["Folder"],
  renameDocument: ["PdfDocument"],
};

/**
 * The tag types a dispatched action invalidates, or `null` when it invalidates
 * nothing.
 *
 * Read off the action's shape rather than off `baseApi.endpoints`: the
 * middleware is installed when the store is created, before any component has
 * imported the slices that inject their endpoints, so the endpoint table may
 * still be empty at that point. `meta.arg` is RTK Query's own record of the call.
 *
 * Rejected mutations return `null`: the optimistic patch has already been rolled
 * back, and the other window's copy was never told to change. `invalidateTags`
 * itself is not a mutation, which is what stops the forwarding from echoing.
 */
export function tagTypesForAction(action: unknown): string[] | null {
  if (!action || typeof action !== "object") return null;
  const typed = action as {
    type?: unknown;
    meta?: { arg?: { type?: unknown; endpointName?: unknown } };
  };
  if (typeof typed.type !== "string" || !typed.type.endsWith("/fulfilled")) return null;

  const arg = typed.meta?.arg;
  if (!arg || arg.type !== "mutation" || typeof arg.endpointName !== "string") return null;

  return MUTATION_TAG_TYPES[arg.endpointName] ?? null;
}

/**
 * Forwards the tag types of every fulfilled mutation through `send`.
 *
 * `send` is injected so the middleware can be tested without Tauri; in the app
 * it is `broadcastInvalidate` from `windowBridge`.
 */
export const crossWindowSync =
  (send: (types: string[]) => void): Middleware =>
  () =>
  (next) =>
  (action) => {
    const result = next(action);
    const types = tagTypesForAction(action);
    if (types) send(types);
    return result;
  };

/**
 * The tag type names `baseApi` knows. The wire carries plain strings, so the
 * receive side has to be told what it is claiming they are; deriving the union
 * from the API keeps that claim in step with `tagTypes`.
 */
type TagType = Parameters<typeof baseApi.util.invalidateTags>[0][number] & string;

/** Apply an invalidation this window received from the other one. */
export function applyRemoteInvalidation(dispatch: AppDispatch, types: string[]): void {
  if (types.length === 0) return;
  dispatch(baseApi.util.invalidateTags(types as TagType[]));
}
