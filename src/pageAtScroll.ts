/**
 * Which page a document's scroll is showing.
 *
 * The hover preview stacks a document's pages in one scroll container and marks
 * the page at the top of it — so the scroll is the page turn, and this is the rule
 * that says what the scroll means. It is not "the page most visible": a page is
 * taken up as soon as its top passes the top of the sheet, and a page taller than
 * the sheet keeps its mark while it is scrolled inside. That is what a reader
 * watching the count expects, and it is what makes the mark settle instead of
 * flickering between two pages that share the window.
 *
 * Pure, and given the offsets rather than the elements, so the one rule is testable
 * without a DOM — and so a hundred-page document costs a binary search, not a walk
 * down every page on every scroll event.
 */

/** How close to the bottom still counts as the end, in CSS pixels. */
const END_SLACK_PX = 2;

export type ScrollPosition = {
  /** How far the container is scrolled, in CSS pixels. */
  top: number;
  /** The container's own height. */
  height: number;
  /** Everything inside it: the stack of pages, gaps included. */
  content: number;
};

/**
 * The 1-based page being read, from each page's offset from the top of the content.
 *
 * `offsetAt` is asked for offsets by 0-based index and is only called a handful of
 * times: the search is a binary search over offsets that already ascend.
 */
export function pageAtScroll(
  pageCount: number,
  offsetAt: (index: number) => number,
  scroll: ScrollPosition,
): number {
  if (pageCount <= 0) return 1;

  // At the end the last page may be shorter than the sheet, so the bottom of the
  // scroll — not the top — is what says the document is being read to its last page.
  if (scroll.top + scroll.height >= scroll.content - END_SLACK_PX) return pageCount;

  // Otherwise: the last page that has begun at or above the top edge. The one pixel
  // makes the page under the edge count as begun rather than as one still above it.
  const line = scroll.top + 1;
  let low = 0;
  let high = pageCount - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (offsetAt(middle) <= line) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found + 1;
}
