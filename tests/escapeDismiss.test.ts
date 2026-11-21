import { describe, expect, test } from "bun:test";
import {
  ESCAPE_LAYERS,
  closedByEscape,
  escapeKeptByEditor,
  type OverlayState,
} from "../src/escapeDismiss";

const open = (over: Partial<OverlayState> = {}): OverlayState => ({
  stripMenu: false,
  search: false,
  notesPanel: false,
  band: false,
  ...over,
});

describe("closedByEscape", () => {
  test("one press closes everything that is open", () => {
    expect(closedByEscape(open({ stripMenu: true, search: true, notesPanel: true, band: true })))
      .toEqual(["stripMenu", "search", "notesPanel", "band"]);
  });

  test("the column and the reading strip go together", () => {
    // This is the case that used to take two presses: the first closed the
    // column and left the band up, which is not what "close" looks like.
    expect(closedByEscape(open({ notesPanel: true, band: true }))).toEqual(["notesPanel", "band"]);
  });

  test("the search bar and the reading strip go together", () => {
    expect(closedByEscape(open({ search: true, band: true }))).toEqual(["search", "band"]);
  });

  test("three layers still cost one press", () => {
    expect(closedByEscape(open({ stripMenu: true, search: true, notesPanel: true })))
      .toEqual(["stripMenu", "search", "notesPanel"]);
  });

  test("a single open layer closes on its own", () => {
    for (const layer of ESCAPE_LAYERS) {
      expect(closedByEscape(open({ [layer]: true }))).toEqual([layer]);
    }
  });

  test("nothing open means nothing to close", () => {
    expect(closedByEscape(open())).toEqual([]);
  });

  test("the order is innermost first, whatever the open set", () => {
    // The caller applies the closes in this order, so it is part of the contract.
    expect(closedByEscape(open({ band: true, notesPanel: true, search: true, stripMenu: true })))
      .toEqual(["stripMenu", "search", "notesPanel", "band"]);
    expect(closedByEscape(open({ band: true, notesPanel: true })))
      .toEqual(["notesPanel", "band"]);
    expect(ESCAPE_LAYERS).toEqual(["stripMenu", "search", "notesPanel", "band"]);
  });
});

describe("escapeKeptByEditor", () => {
  test("an open popup owns the key, wherever the press started", () => {
    // The bug this rule replaced: the popup was recognised by the *event target*
    // being inside it. Its preview pane takes no focus, so clicking there left the
    // target on the page and one Escape closed the popup, the column and the band —
    // taking away the passage the half-written note was about.
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
