import { describe, expect, test } from "bun:test";
import { STRIP_DISMISS_EXEMPT, dismissesStrip } from "../src/stripDismiss";

/** A clicked element that sits inside the surfaces named here. */
const elementIn = (...selectors: string[]) => ({
  closest: (selector: string) => (selectors.includes(selector) ? {} : null),
});

const clickOn = (
  target: ReturnType<typeof elementIn> | null,
  over: { button?: number; clickCount?: number; notesPanelOpen?: boolean } = {},
) => {
  const { notesPanelOpen = false, ...click } = over;
  return dismissesStrip({ button: 0, clickCount: 1, target, ...click }, { notesPanelOpen });
};

describe("dismissesStrip", () => {
  test("a click on the page dismisses the strip", () => {
    expect(clickOn(elementIn())).toBe(true);
  });

  test("a click inside the band, its menu, the toolbar or the note dialog does not", () => {
    expect(clickOn(elementIn(STRIP_DISMISS_EXEMPT[0]))).toBe(false);
    expect(clickOn(elementIn(STRIP_DISMISS_EXEMPT[1]))).toBe(false);
    expect(clickOn(elementIn(STRIP_DISMISS_EXEMPT[2]))).toBe(false);
    expect(clickOn(elementIn(STRIP_DISMISS_EXEMPT[3]))).toBe(false);
  });

  test("every exempt surface passes the click through", () => {
    for (const selector of STRIP_DISMISS_EXEMPT) {
      expect(clickOn(elementIn(selector))).toBe(false);
    }
  });

  test("the band, its menu, the toolbar and the note dialog are the whole exception list", () => {
    expect([...STRIP_DISMISS_EXEMPT]).toEqual([
      ".focus-band",
      ".toolbar",
      ".strip-menu",
      ".note-backdrop",
    ]);
  });

  test("the second click of a double-click is left to the park handler", () => {
    // Click 1 clears the old strip, click 2 (detail 2) parks the new one; a third
    // click belongs to a triple-click selection and is not a dismissal either.
    expect(clickOn(elementIn(), { clickCount: 1 })).toBe(true);
    expect(clickOn(elementIn(), { clickCount: 2 })).toBe(false);
    expect(clickOn(elementIn(), { clickCount: 3 })).toBe(false);
  });

  test("the middle and right buttons never dismiss, even on the page", () => {
    expect(clickOn(elementIn(), { button: 1 })).toBe(false);
    expect(clickOn(elementIn(), { button: 2 })).toBe(false);
    // A right-click on the band's menu must not close the strip behind it.
    expect(clickOn(elementIn(".strip-menu"), { button: 2 })).toBe(false);
  });

  test("a click whose target is not an element leaves the strip alone", () => {
    expect(clickOn(null)).toBe(false);
  });

  test("while the Notes of this PDF column is open the click closes it, not the strip", () => {
    // The column is a layer above the page, so the click is its to handle — on
    // the page, on a card in the column, or on the band behind it.
    expect(clickOn(elementIn(), { notesPanelOpen: true })).toBe(false);
    expect(clickOn(elementIn(".doc-notes"), { notesPanelOpen: true })).toBe(false);
    expect(clickOn(elementIn(".focus-band"), { notesPanelOpen: true })).toBe(false);
    // The button and click-count rules are moot rather than reversed.
    expect(clickOn(elementIn(), { notesPanelOpen: true, button: 2 })).toBe(false);
    expect(clickOn(elementIn(), { notesPanelOpen: true, clickCount: 2 })).toBe(false);
  });

  test("closing the column hands the outside click back to the strip", () => {
    expect(clickOn(elementIn(), { notesPanelOpen: false })).toBe(true);
    expect(clickOn(elementIn(), { notesPanelOpen: true })).toBe(false);
    expect(clickOn(elementIn(), { notesPanelOpen: false })).toBe(true);
  });
});
