import { describe, expect, test } from "bun:test";
import { STRIP_DISMISS_EXEMPT, dismissesStrip } from "../src/stripDismiss";

/** A clicked element that sits inside the surfaces named here. */
const elementIn = (...selectors: string[]) => ({
  closest: (selector: string) => (selectors.includes(selector) ? {} : null),
});

const clickOn = (
  target: ReturnType<typeof elementIn> | null,
  over: { button?: number; clickCount?: number } = {},
) => dismissesStrip({ button: 0, clickCount: 1, target, ...over });

describe("dismissesStrip", () => {
  test("a click on the page dismisses the strip", () => {
    expect(clickOn(elementIn())).toBe(true);
  });

  test("a click inside the band, its note badge, its menu, the toolbar or the note dialog does not", () => {
    for (const selector of STRIP_DISMISS_EXEMPT) {
      expect(clickOn(elementIn(selector))).toBe(false);
    }
    // Named one by one as well, so a reordering of the list cannot quietly
    // change which surface is exempt.
    expect(clickOn(elementIn(".focus-band"))).toBe(false);
    expect(clickOn(elementIn(".remark-marker"))).toBe(false);
    expect(clickOn(elementIn(".toolbar"))).toBe(false);
    expect(clickOn(elementIn(".strip-menu"))).toBe(false);
    expect(clickOn(elementIn(".note-backdrop"))).toBe(false);
    expect(clickOn(elementIn(".doc-notes"))).toBe(false);
  });

  test("the band, its badge, its menu, the toolbar, the note dialog and the notes column are the whole exception list", () => {
    expect([...STRIP_DISMISS_EXEMPT]).toEqual([
      ".focus-band",
      ".remark-marker",
      ".toolbar",
      ".strip-menu",
      ".note-backdrop",
      ".doc-notes",
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

  test("the notes column is exempt, and a click beside it is the page's again", () => {
    // Reading notes is not leaving focus mode: picking a card, resizing the column
    // or putting the caret in a note field keeps the strip up.
    expect(clickOn(elementIn(".doc-notes"))).toBe(false);
    expect(clickOn(elementIn(".doc-notes", ".notes-card"))).toBe(false);
    // The column no longer closes on an outside click, so a click on the page is
    // the strip's to answer — there is no second dismissal to share it with.
    expect(clickOn(elementIn())).toBe(true);
    expect(clickOn(elementIn(".scroller"))).toBe(true);
  });
});
