/**
 * The two pure pieces of scrolling a list mid-drag: what a wheel asks for, and how
 * far the edge of the list moves in a frame. The rest of `dragScroll` is DOM —
 * finding the scroll box, and adding a gesture to it — and is exercised by using
 * the app rather than here.
 */
import { describe, expect, test } from "bun:test";
import {
  DRAG_SCROLL_EDGE_PX,
  DRAG_SCROLL_MAX_PX,
  edgeScrollStep,
  wheelPixels,
} from "../src/dragScroll";

const VIEWPORT = 600;

describe("wheelPixels", () => {
  test("a trackpad already reports pixels", () => {
    expect(wheelPixels({ deltaY: 42, deltaMode: 0 }, VIEWPORT)).toBe(42);
    expect(wheelPixels({ deltaY: -42, deltaMode: 0 }, VIEWPORT)).toBe(-42);
  });

  test("a mouse's lines are brought to pixels", () => {
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 }, VIEWPORT)).toBe(48);
    expect(wheelPixels({ deltaY: -1, deltaMode: 1 }, VIEWPORT)).toBe(-16);
  });

  test("a page-mode wheel is the scroller's own height per page", () => {
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 }, VIEWPORT)).toBe(VIEWPORT);
    expect(wheelPixels({ deltaY: 2, deltaMode: 2 }, 300)).toBe(600);
  });

  test("a wheel that moved nothing is answered with nothing", () => {
    // Momentum's last event can be a zero delta, and a horizontal-only one has no
    // `deltaY` to give; neither should count as a scroll.
    expect(wheelPixels({ deltaY: 0, deltaMode: 0 }, VIEWPORT)).toBe(0);
    expect(wheelPixels({ deltaY: 0, deltaMode: 1 }, VIEWPORT)).toBe(0);
  });
});

describe("edgeScrollStep", () => {
  test("the edge itself is the fastest step", () => {
    expect(edgeScrollStep(DRAG_SCROLL_EDGE_PX)).toBe(DRAG_SCROLL_MAX_PX);
  });

  test("deeper into the band is faster, and half way is half", () => {
    expect(edgeScrollStep(DRAG_SCROLL_EDGE_PX / 2)).toBe(Math.round(DRAG_SCROLL_MAX_PX / 2));
    expect(edgeScrollStep(DRAG_SCROLL_EDGE_PX / 4)).toBe(Math.round(DRAG_SCROLL_MAX_PX / 4));
  });

  test("past the edge it does not go faster than the maximum", () => {
    // The pointer can leave the list entirely while the drag continues.
    expect(edgeScrollStep(DRAG_SCROLL_EDGE_PX * 4)).toBe(DRAG_SCROLL_MAX_PX);
  });

  test("a step is never zero", () => {
    // One pixel into the band is still a band: it moves, slowly.
    expect(edgeScrollStep(1)).toBe(1);
    expect(edgeScrollStep(0.2)).toBe(1);
  });
});
