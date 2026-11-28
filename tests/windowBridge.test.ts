import { describe, expect, test } from "bun:test";
import {
  NotesEvent,
  ViewerEvent,
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
  parseShowAnnotationRequest,
  parseShowNoteRequest,
  publishViewerDocument,
  showAnnotationInViewerWindow,
  showNoteInViewerWindow,
  subscribe,
  referencePlacementFor,
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
  });  test("opening a document in a window of its own resolves without a bridge", async () => {
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

  test("a passage has no window to look for, and none to be shown in", async () => {
    // The plain web build is one window: the docked column answers a reference,
    // and nothing here can open or find another.
    expect(await referencePlacementFor("/a.pdf", "/a.pdf")).toEqual({ kind: "open" });
    expect(
      await showNoteInViewerWindow("viewer-note-a", {
        filePath: "/a.pdf",
        strip: { id: 1, page_number: 1, top: 10, height: 20, page_height: 800 },
      }),
    ).toBe(false);
    expect(
      await showAnnotationInViewerWindow("viewer-note-a", {
        filePath: "/a.pdf",
        annotation: { id: 1, page_number: 1, y: 100 },
      }),
    ).toBe(false);
  });

  test("publishing a document is a no-op rather than a storage write", () => {
    expect(() => publishViewerDocument("/a.pdf")).not.toThrow();
    expect(() => publishViewerDocument(null)).not.toThrow();
  });
});

describe("parseShowNoteRequest", () => {
  const strip = { id: 7, page_number: 3, top: 40, height: 60, page_height: 792 };

  test("reads the passage a window is asked to stand on", () => {
    expect(parseShowNoteRequest({ filePath: "/tmp/a.pdf", strip })).toEqual({
      filePath: "/tmp/a.pdf",
      strip,
    });
  });

  test("keeps only what a band needs, whatever else the sender sent", () => {
    const parsed = parseShowNoteRequest({
      filePath: "/tmp/a.pdf",
      strip: { ...strip, remark: "a long note", highlights: "[]", pdf_document_id: 4 },
    });
    expect(parsed?.strip).toEqual(strip);
  });

  test("refuses a request that is not one", () => {
    for (const value of [null, undefined, 3, "note", [], {}]) {
      expect(parseShowNoteRequest(value)).toBeNull();
    }
    expect(parseShowNoteRequest({ filePath: "", strip })).toBeNull();
    expect(parseShowNoteRequest({ filePath: "/a.pdf" })).toBeNull();
  });

  test("refuses a band that cannot be parked", () => {
    const bad = [
      { ...strip, id: 0 },
      { ...strip, id: 1.5 },
      { ...strip, page_number: 0 },
      { ...strip, page_number: "3" },
      { ...strip, top: Number.NaN },
      { ...strip, height: null },
      { ...strip, page_height: undefined },
      { ...strip, page_height: Number.POSITIVE_INFINITY },
    ];
    for (const broken of bad) {
      expect(parseShowNoteRequest({ filePath: "/tmp/a.pdf", strip: broken })).toBeNull();
    }
  });
});

describe("parseShowAnnotationRequest", () => {
  const annotation = { id: 9, page_number: 2, y: 120.5 };

  test("reads the point a window is asked to show", () => {
    expect(parseShowAnnotationRequest({ filePath: "/tmp/a.pdf", annotation })).toEqual({
      filePath: "/tmp/a.pdf",
      annotation,
    });
  });

  test("refuses a request that is not one", () => {
    for (const value of [null, undefined, 7, [], {}]) {
      expect(parseShowAnnotationRequest(value)).toBeNull();
    }
    expect(parseShowAnnotationRequest({ filePath: "/a.pdf" })).toBeNull();
    expect(
      parseShowAnnotationRequest({ filePath: "/a.pdf", annotation: { ...annotation, id: 0 } }),
    ).toBeNull();
    expect(
      parseShowAnnotationRequest({ filePath: "/a.pdf", annotation: { ...annotation, y: "120" } }),
    ).toBeNull();
    expect(
      parseShowAnnotationRequest({ filePath: "/a.pdf", annotation: { ...annotation, page_number: 0 } }),
    ).toBeNull();
  });
});

describe("the messages a viewer sends a viewer", () => {
  test("are the events a viewer subscribes to", () => {
    expect(ViewerEvent.ShowNote).toBe("viewer:show-note");
    expect(ViewerEvent.ShowAnnotation).toBe("viewer:show-annotation");
    // Deliberately not the notes column's events: those are a column talking to
    // the viewer that owns it, these are two viewers talking.
    expect(ViewerEvent.ShowNote).not.toContain("notes:");
    expect(ViewerEvent.ShowAnnotation).not.toContain("notes:");
  });
});
