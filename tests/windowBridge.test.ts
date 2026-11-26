import { describe, expect, test } from "bun:test";
import {
  NotesEvent,
  emitToNotes,
  getNotesWindow,
  isNotesWindow,
  isTauri,
  notesOwnerLabel,
  notesWindowLabel,
  openAppWindow,
  openDocumentViewerWindow,
  openReferenceViewerWindow,
  parseNotesContext,
  subscribe,
  type NotesContext,
} from "../src/windowBridge";

const snapshot: NotesContext = {
  document: { filePath: "/tmp/chapter-3.pdf", documentName: "chapter-3.pdf", pageCount: 42 },
  pathless: false,
  revealId: 7,
  pendingEditId: null,
};

describe("isNotesWindow", () => {
  test("recognises the query string the popped-out window is created with", () => {
    expect(isNotesWindow("?view=notes")).toBe(true);
    expect(isNotesWindow("?view=notes&anything=else")).toBe(true);
  });

  test("leaves the main window alone", () => {
    expect(isNotesWindow("")).toBe(false);
    expect(isNotesWindow("?view=pdf")).toBe(false);
    expect(isNotesWindow("?notes=1")).toBe(false);
  });
});

describe("parseNotesContext", () => {
  test("round-trips a snapshot the main window sends", () => {
    expect(parseNotesContext(snapshot)).toEqual(snapshot);
  });

  test("accepts the no-document snapshots", () => {
    // Nothing open at all.
    expect(parseNotesContext({ document: null, pathless: false, revealId: null, pendingEditId: null }))
      .toEqual({ document: null, pathless: false, revealId: null, pendingEditId: null });
    // A PDF opened from bytes: there is a document on screen but no file to store
    // strips against, which is a different message.
    expect(parseNotesContext({ document: null, pathless: true, revealId: null, pendingEditId: null }))
      .toEqual({ document: null, pathless: true, revealId: null, pendingEditId: null });
  });

  test("does not require the page count", () => {
    const withoutCount = {
      ...snapshot,
      document: { filePath: "/tmp/a.pdf", documentName: "a.pdf" },
    };
    expect(parseNotesContext(withoutCount)).toEqual({
      ...snapshot,
      document: { filePath: "/tmp/a.pdf", documentName: "a.pdf" },
    });
  });

  test("normalises absent ids to null", () => {
    expect(
      parseNotesContext({ document: null, pathless: false }),
    ).toEqual({ document: null, pathless: false, revealId: null, pendingEditId: null });
  });

  test("rejects anything that is not a snapshot", () => {
    for (const value of [null, undefined, "notes", 3, [], {}]) {
      expect(parseNotesContext(value)).toBeNull();
    }
  });

  test("rejects a malformed document instead of rendering it", () => {
    const bad = [
      { filePath: 3, documentName: "a.pdf" },
      { filePath: "", documentName: "a.pdf" },
      { filePath: "/tmp/a.pdf", documentName: null },
      { filePath: "/tmp/a.pdf", documentName: "a.pdf", pageCount: "42" },
      { filePath: "/tmp/a.pdf", documentName: "a.pdf", pageCount: Number.NaN },
      "a.pdf",
      7,
    ];
    for (const document of bad) {
      expect(parseNotesContext({ ...snapshot, document })).toBeNull();
    }
  });

  test("rejects wrong types for the rest of the payload", () => {
    expect(parseNotesContext({ ...snapshot, pathless: "no" })).toBeNull();
    expect(parseNotesContext({ document: null })).toBeNull();
    expect(parseNotesContext({ ...snapshot, document: undefined })).toBeNull();
    expect(parseNotesContext({ ...snapshot, revealId: "7" })).toBeNull();
    expect(parseNotesContext({ ...snapshot, revealId: 1.5 })).toBeNull();
    expect(parseNotesContext({ ...snapshot, pendingEditId: true })).toBeNull();
  });
});

describe("notes windows", () => {
  test("the original window keeps the single notes label", () => {
    expect(notesWindowLabel("main")).toBe("notes");
  });

  test("a copy of the app gets a notes window of its own", () => {
    expect(notesWindowLabel("app-m1-2")).toBe("notes-app-m1-2");
  });

  test("a notes window with no owner belongs to the original window", () => {
    expect(notesOwnerLabel("?view=notes")).toBe("main");
    expect(notesOwnerLabel("")).toBe("main");
  });

  test("a notes window reports back to the copy that opened it", () => {
    expect(notesOwnerLabel("?view=notes&owner=app-m1-2")).toBe("app-m1-2");
  });
});

describe("outside Tauri", () => {
  test("opening a reference viewer resolves without a bridge", async () => {
    await expect(
      openReferenceViewerWindow({ filePath: "/a.pdf", noteId: 2 }),
    ).resolves.toBeUndefined();
  });

  test("opening a document in a window of its own resolves without a bridge", async () => {
    await expect(
      openDocumentViewerWindow({ documentId: 3, filePath: "/a.pdf", documentName: "a.pdf" }),
    ).resolves.toBeUndefined();
  });

  test("opening a new window resolves without a bridge", async () => {
    await expect(openAppWindow()).resolves.toBeUndefined();
  });

  test("there is no bridge to report", async () => {
    expect(isTauri()).toBe(false);
    expect(await getNotesWindow()).toBeNull();
  });

  test("the helpers resolve instead of throwing", async () => {
    await expect(emitToNotes(NotesEvent.Context, snapshot)).resolves.toBeUndefined();
    const unsubscribe = subscribe(NotesEvent.Context, () => {
      throw new Error("the web build must never deliver bridge events");
    });
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });
});
