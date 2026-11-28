import { describe, expect, test } from "bun:test";
import {
  activeHeldTheme,
  createEditorThemeHolds,
  themeAfterSetTheme,
} from "../src/markdown/editorThemeHold";

const CARD = "pdf-focus-viewer-card";
const POPUP = "pdf-focus-viewer";

describe("activeHeldTheme", () => {
  test("a higher priority wins, and the latest hold wins a tie", () => {
    expect(activeHeldTheme([])).toBeNull();
    expect(
      activeHeldTheme([
        { theme: CARD, priority: 0 },
        { theme: POPUP, priority: 1 },
      ]),
    ).toBe(POPUP);
    expect(
      activeHeldTheme([
        { theme: POPUP, priority: 1 },
        { theme: CARD, priority: 0 },
      ]),
    ).toBe(POPUP);
    expect(
      activeHeldTheme([
        { theme: CARD, priority: 0 },
        { theme: "other", priority: 0 },
      ]),
    ).toBe("other");
  });
});

describe("themeAfterSetTheme", () => {
  test("a held theme survives the editor library calling setTheme", () => {
    // The popup is open, so the card's editor being created must not paint the popup green.
    expect(themeAfterSetTheme(CARD, POPUP)).toBe(POPUP);
    // Nothing is holding a theme yet: the call is the editor's own theme.
    expect(themeAfterSetTheme(CARD, null)).toBe(CARD);
  });
});

describe("createEditorThemeHolds", () => {
  test("closing the popup puts the card's theme back", () => {
    const applied: string[] = [];
    const holds = createEditorThemeHolds((theme) => applied.push(theme));

    const releaseCard = holds.hold(CARD, 0);
    const releasePopup = holds.hold(POPUP, 1);
    releasePopup();

    expect(applied).toEqual([CARD, POPUP, CARD]);
    expect(holds.active()).toBe(CARD);

    releaseCard();
    // The last editor leaving does not invent a theme to apply.
    expect(applied).toEqual([CARD, POPUP, CARD]);
    expect(holds.active()).toBeNull();
  });

  test("the card mounting while the popup is open does not take the theme", () => {
    const applied: string[] = [];
    const holds = createEditorThemeHolds((theme) => applied.push(theme));

    const releasePopup = holds.hold(POPUP, 1);
    holds.hold(CARD, 0);

    expect(applied).toEqual([POPUP, POPUP]);
    expect(holds.active()).toBe(POPUP);

    releasePopup();
    expect(holds.active()).toBe(CARD);
    expect(applied.at(-1)).toBe(CARD);
  });

  test("releasing a hold twice does not drop the editor that is still there", () => {
    const applied: string[] = [];
    const holds = createEditorThemeHolds((theme) => applied.push(theme));

    holds.hold(CARD, 0);
    const releasePopup = holds.hold(POPUP, 1);
    releasePopup();
    releasePopup();

    expect(holds.active()).toBe(CARD);
    expect(applied).toEqual([CARD, POPUP, CARD]);
  });
});
