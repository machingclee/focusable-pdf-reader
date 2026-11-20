import { describe, expect, test } from "bun:test";
import { CARD_LINE_FRACTION, cardScrollTop } from "../src/notesScroll";

/** A list 600 px tall with `cardTop` as the card's place in its content. */
const place = (cardTop: number, maxScrollTop: number, viewportHeight = 600) =>
  cardScrollTop({ cardTop, viewportHeight, maxScrollTop });

describe("cardScrollTop", () => {
  test("puts the card's top edge a fifth of the way down the list", () => {
    // The card starts 500 px into the content; with a 600 px viewport the line is
    // at 120 px, so the list scrolls 380 px.
    expect(place(500, 2000)).toBe(380);
    expect(CARD_LINE_FRACTION).toBe(1 / 5);
  });

  test("a card near the top lands at the top instead of scrolling past it", () => {
    expect(place(60, 2000)).toBe(0);
    expect(place(0, 2000)).toBe(0);
  });

  test("a card near the end falls back to the bottom of the list", () => {
    // The line is unreachable: 4000 - 120 is far beyond the last offset.
    expect(place(4000, 900)).toBe(900);
    // Exactly reachable: the line and the end of the list agree.
    expect(place(1020, 900)).toBe(900);
    expect(place(1019, 900)).toBe(899);
  });

  test("a list that does not scroll answers 0", () => {
    expect(place(500, 0)).toBe(0);
    expect(place(500, -20)).toBe(0);
  });

  test("the line is an input, so the rule is testable without the app's constant", () => {
    expect(cardScrollTop({ cardTop: 500, viewportHeight: 600, maxScrollTop: 2000, lineFraction: 0.5 }))
      .toBe(200);
  });
});
