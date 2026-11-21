/**
 * Restarting a class-driven CSS animation on the element itself.
 *
 * A CSS animation starts when its `animation-name` arrives at an element that did
 * not have it; leave the class on and nothing moves again. That is fine for a
 * state, and wrong for an answer: pressing the same note twice has to wobble
 * twice, and the state did not change, so React renders nothing.
 *
 * The class has to come off *and* the style has to be recalculated while it is off,
 * because a re-add in the same style pass is simply the animation that was already
 * there. That recalculation is the one unobvious part, and the reason this is a
 * function with a test rather than three lines inside a click handler: the order is
 * the fix.
 *
 * The element is asked for a layout length (`offsetWidth`) — the value is thrown
 * away. Reading a length forces the pending style change to be resolved first, so
 * the browser has genuinely seen the class absent, and the add that follows starts a
 * new animation rather than continuing the old one.
 *
 * Timing matters as much as the order: this must run *before* the frame's style pass
 * (synchronously in the event handler, not in a `requestAnimationFrame` callback,
 * which runs before it). A frame callback would put the class back in the same pass
 * that would have noticed it gone, which is exactly the bug this replaces.
 */

/** The node the restart needs: a class list, and a layout length to read. */
export type RestartableNode = {
  classList: {
    remove(token: string): void;
    add(token: string): void;
  };
  /** Read only for its side effect; the number is never used. */
  readonly offsetWidth: number;
};

/**
 * Start `node`'s `className` animation over from the first frame.
 *
 * Safe to call when the class was not on the node: the remove does nothing, the
 * read still flushes, and the add starts the animation as it would have anyway.
 */
export function restartClassAnimation(node: RestartableNode, className: string): void {
  node.classList.remove(className);
  // The read *is* the restart. Without it the add lands in the same style pass as
  // the remove and the animation never stops.
  void node.offsetWidth;
  node.classList.add(className);
}
