import { describe, expect, test } from "bun:test";
import {
  ESCAPE_LAYERS,
  closedByEscape,
  escapeKeptByEditor,
  type EscapeLayer,
  type OverlayState,
} from "../src/escapeDismiss";

const open = (over: Partial<OverlayState> = {}): OverlayState => ({
  eventLog: false,
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
      .toBe("band");
    expect(closedByEscape(open({ notesPanel: true, band: true }))).toBe("band");
  });

  test("the reading strip closes first, ahead of every other layer", () => {
    // The strip is what Escape is for once it is on: a press turns it off and
    // leaves the log, the find field, the band's menu and the notes column
    // exactly where they were.
    expect(closedByEscape(open({ eventLog: true, band: true }))).toBe("band");
    expect(closedByEscape(open({ eventLog: true, notesPanel: true, band: true }))).toBe("band");
    expect(closedByEscape(open({ eventLog: true, search: true, notesPanel: true, band: true })))
      .toBe("band");
    expect(closedByEscape(open({ stripMenu: true, search: true, notesPanel: true, band: true })))
      .toBe("band");
    expect(closedByEscape(open({ band: true }))).toBe("band");
  });

  test("with the strip off, the event log closes alone, ahead of the other layers", () => {
    // The log is a column watched *while* the viewer is used, not a modal over it:
    // a press while it is up and the strip is off puts the log away and leaves
    // the notes column, the find field and the band's menu exactly where they were.
    expect(closedByEscape(open({ eventLog: true, notesPanel: true }))).toBe("eventLog");
    expect(closedByEscape(open({ eventLog: true, search: true, notesPanel: true }))).toBe("eventLog");
    expect(closedByEscape(open({ eventLog: true, stripMenu: true }))).toBe("eventLog");
  });

  test("the reading strip closes before the notes column it was read beside", () => {
    // The press that ends the strip is not the press that ends the aside: the
    // first turns the strip off, the second gives the page its window back.
    expect(closedByEscape(open({ notesPanel: true, band: true }))).toBe("band");
    expect(closedByEscape(open({ notesPanel: true }))).toBe("notesPanel");
  });

  test("the reading strip goes before the search bar and the band's menu too", () => {
    expect(closedByEscape(open({ search: true, band: true }))).toBe("band");
    expect(closedByEscape(open({ stripMenu: true, band: true }))).toBe("band");
    // With the strip off, the menu a reader just opened is the first thing a
    // press takes away.
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
    // The whole contract in one pass: every layer open, one press each, the
    // strip first. The caller applies exactly the layer this function names.
    expect(
      pressesToCloseEverything(
        open({ eventLog: true, stripMenu: true, search: true, notesPanel: true, band: true }),
      ),
    ).toEqual(["band", "eventLog", "stripMenu", "search", "notesPanel"]);
    expect(pressesToCloseEverything(open({ stripMenu: true, search: true, notesPanel: true, band: true })))
      .toEqual(["band", "stripMenu", "search", "notesPanel"]);
    expect(pressesToCloseEverything(open({ notesPanel: true, band: true })))
      .toEqual(["band", "notesPanel"]);
    expect(pressesToCloseEverything(open({ band: true, notesPanel: true, search: true })))
      .toEqual(["band", "search", "notesPanel"]);
    expect(ESCAPE_LAYERS).toEqual(["band", "eventLog", "stripMenu", "search", "notesPanel"]);
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
