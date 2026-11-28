/**
 * The annotation tool's life: a new document puts it away, and a pin that a
 * reference just found is ringed once.
 *
 * The pins belong to the document — they are rows against its id — so a document
 * that goes away must take any editor, menu, move or armed tool with it, the same
 * way it takes the pen and the band. Leaving them armed would point the next
 * click at rows of a file that is no longer open.
 *
 * The ring is the other half of the same idea: when a reference lands on a pin,
 * the reader has been moved to a place with several pins on it and has to be told
 * which one. The ring is a moment of attention, not a state — leaving it on would
 * make one annotation look selected for ever — so it clears itself.
 */
import { useEffect, useRef } from "react";

/** How long a just-found pin stays ringed. */
export const FOUND_ANNOTATION_RING_MS = 1800;

export type AnnotationLifecycleOptions = {
  /** The open document's path; a different one is a different set of pins. */
  documentPath: string | null;
  /** Put the tool away and drop every in-flight edit, menu and move. */
  reset: () => void;
  /** The pin a reference just scrolled to, or null. */
  foundId: number | null;
  /** The ring has had its moment: stop ringing it. */
  clearFound: () => void;
};

export function useAnnotationLifecycle({
  documentPath,
  reset,
  foundId,
  clearFound,
}: AnnotationLifecycleOptions): void {
  // Through refs: the reset belongs to the document changing, and the ring to the
  // pin that was found. A caller passing fresh arrows must not reset the tool on
  // every render, or restart the ring so it never clears.
  const latest = useRef({ reset, clearFound });
  latest.current = { reset, clearFound };

  useEffect(() => {
    latest.current.reset();
  }, [documentPath]);

  useEffect(() => {
    if (foundId === null) return;
    const timer = window.setTimeout(() => latest.current.clearFound(), FOUND_ANNOTATION_RING_MS);
    return () => window.clearTimeout(timer);
  }, [foundId]);
}
