/**
 * The band standing on a saved strip: keeping up with that strip's row.
 *
 * A band parked on a saved strip *is* that row — resizing it and opening its menu
 * writes the row back — so the row can also be taken away from under it. It can be
 * deleted from this window's notes column or from the popped-out one; either way
 * the strip list goes stale and refetches, and the band must not go on framing a
 * passage whose note no longer exists, because it then looks like the note is
 * still there. The band is closed rather than left standing somewhere unrelated:
 * the reader deleted the note, not moved their place.
 *
 * The hard part is that "not in the list" and "not in the list *yet*" look the
 * same. A strip that was just saved is not in the list for a moment — the write
 * has answered, the invalidation's refetch has not — so an absent row directly
 * after the band lands on it is a list that has not caught up, not a deletion.
 * That is what `seen` remembers: the row has to have been seen once before its
 * absence means anything.
 */
import { useEffect, useRef } from "react";
import type { Note } from "../../types/dto";

export type SavedStripStandingOptions = {
  /** The saved strip the band is standing on, or null when it stands on nothing. */
  standingOn: number | null;
  /** The open document's strips, or undefined while they are still loading. */
  strips: Note[] | undefined;
  /** The row is gone: put the band away. */
  onDeleted: () => void;
};

export function useSavedStripStanding({
  standingOn,
  strips,
  onDeleted,
}: SavedStripStandingOptions): void {
  /** Whether that row has been seen in the list since the band came to stand on it. */
  const seen = useRef(false);
  const latestOnDeleted = useRef(onDeleted);
  latestOnDeleted.current = onDeleted;

  useEffect(() => {
    seen.current = false;
  }, [standingOn]);

  useEffect(() => {
    if (standingOn === null) return;
    // Still loading, or not fetched for this document yet: no verdict.
    if (!strips) return;
    if (strips.some((strip) => strip.id === standingOn)) {
      seen.current = true;
      return;
    }
    if (!seen.current) return;
    seen.current = false;
    latestOnDeleted.current();
  }, [standingOn, strips]);
}
