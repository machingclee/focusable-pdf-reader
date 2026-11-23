/**
 * What a window does when it hears that the backend has changed.
 *
 * The sending half lives in the API layer (`store/api/baseApi.ts`): a write that
 * the backend accepted announces itself to every window. This is the receiving
 * half, and it is deliberately the blunt one — the announcement says nothing
 * about *what* changed, so the answer is to mark every tag type stale:
 *
 * `invalidateEveryTag` → one `api/invalidateTags` dispatch → RTK Query refetches
 * whatever this window is subscribed to, and marks the rest stale until it is
 * used again.
 *
 * A table of "which write makes which query stale" would be a second description
 * of the endpoints, and it drifts the first day a handler writes a row the table
 * did not know about; then one window quietly shows yesterday's data. This is a
 * local application talking to a backend on the same machine: a few refetches per
 * write are free, and a stale card is not.
 */
import { ALL_TAG_TYPES, baseApi, type TagType } from "./api/baseApi";
import type { AppDispatch } from "./store";

/**
 * Every tag type, as a fresh list.
 *
 * Read from the API's own declaration, so a tag type added there is invalidated
 * here the same day, with no second list to keep in step.
 */
export function allTagTypes(): TagType[] {
  return [...ALL_TAG_TYPES];
}

/** Mark everything this window has cached as stale. */
export function invalidateEveryTag(dispatch: AppDispatch): void {
  dispatch(baseApi.util.invalidateTags(allTagTypes()));
}
