import { describe, expect, test } from "bun:test";
import {
  ESCAPE_LAYERS,
  closedByEscape,
  escapeKeptByEditor,
  type EscapeLayer,
  type OverlayState,
} from "../src/escapeDismiss";

const open = (over: Partial<OverlayState> = {}): OverlayState => ({
  stripMenu: false,
  search: false,
  notesPanel: false,
  band: false,
  ...over,
});

/** Press Escape until nothing is left, closing what each press answers. */
const pressesToCloseEverything = (start: OverlayState): EscapeLayer[] => {
  const closed: EscapeLayer[] = [];
  let state = start;
  for (let layer = closedByEscape(state); layer; layer = closedByEscape(state)) {
    closed.push(layer);
    state = { ...state, [layer]: false };
  }
  return closed;
};

describe("closedByEscape", () => {
  test("one press closes exactly one layer", () => {
    expect(closedByEscape(open({ stripMenu: true, search: true, notesPanel: true, band: true })))
      .toBe("stripMenu");
    expect(closedByEscape(open({ notesPanel: true, band: true }))).toBe("notesPanel");
  });

  test("the notes column closes before the reading strip it was opened from", () => {
    // The press that ends the aside is not the press that ends the reading
    // session: the first gives the page its window back, the second leaves the
    // mode.
    expect(closedByEscape(open({ notesPanel: true, band: true }))).toBe("notesPanel");
    expect(closedByEscape(open({ band: true }))).toBe("band");
  });

  test("the search bar and the band's menu go before the strip too", () => {
    expect(closedByEscape(open({ search: true, band: true }))).toBe("search");
    expect(closedByEscape(open({ stripMenu: true, band: true }))).toBe("stripMenu");
    // The menu a reader just opened is the first thing a press takes away.
    expect(closedByEscape(open({ stripMenu: true, notesPanel: true }))).toBe("stripMenu");
  });

  test("a single open layer closes on its own", () => {
    for (const layer of ESCAPE_LAYERS) {
      expect(closedByEscape(open({ [layer]: true }))).toBe(layer);
    }
  });

  test("nothing open means nothing to close", () => {
    expect(closedByEscape(open())).toBeNull();
  });

  test("the layers come off in order, one per press", () => {
    // The whole contract in one pass: four open layers, four presses, innermost
    // first. The caller applies exactly the layer this function names.
    expect(pressesToCloseEverything(open({ stripMenu: true, search: true, notesPanel: true, band: true })))
      .toEqual(["stripMenu", "search", "notesPanel", "band"]);
    expect(pressesToCloseEverything(open({ notesPanel: true, band: true })))
      .toEqual(["notesPanel", "band"]);
    expect(pressesToCloseEverything(open({ band: true, notesPanel: true, search: true })))
      .toEqual(["search", "notesPanel", "band"]);
    expect(ESCAPE_LAYERS).toEqual(["stripMenu", "search", "notesPanel", "band"]);
  });
});

describe("escapeKeptByEditor", () => {
  test("an open popup owns the key, wherever the press started", () => {
    // The bug this rule replaced: the popup was recognised by the *event target*
    // being inside it. Its preview pane takes no focus, so clicking there left the
    // target on the page and one Escape closed the column the note was being
    // written in, taking away the passage the half-written note was about.
    expect(escapeKeptByEditor({ noteDialogOpen: true, typingInNotes: false })).toBe(true);
    expect(escapeKeptByEditor({ noteDialogOpen: true, typingInNotes: true })).toBe(true);
  });

  test("no popup and no field being typed in leaves the key to the viewer", () => {
    expect(escapeKeptByEditor({ noteDialogOpen: false, typingInNotes: false })).toBe(false);
  });

  test("the inline card editor keeps its own Escape too", () => {
    // There Escape means "drop this edit", not "close the column".
    expect(escapeKeptByEditor({ noteDialogOpen: false, typingInNotes: true })).toBe(true);
  });
});
