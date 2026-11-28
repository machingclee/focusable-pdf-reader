import { describe, expect, test } from "bun:test";
import {
  listViewers,
  pruneViewers,
  recordViewer,
  referencePlacement,
  touchViewer,
  viewerShowing,
  withdrawViewer,
  type OpenViewer,
  type ViewerRegistryStorage,
} from "../src/openViewers";

/** `localStorage`, as the one thing this module needs from a window. */
class MemoryStorage implements ViewerRegistryStorage {
  private readonly lines = new Map<string, string>();

  get length(): number {
    return this.lines.size;
  }

  key(index: number): string | null {
    return [...this.lines.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.lines.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.lines.set(key, value);
  }

  removeItem(key: string): void {
    this.lines.delete(key);
  }

  /** A key this module does not own, as the rest of the app's storage looks. */
  setForeign(key: string, value: string): void {
    this.lines.set(key, value);
  }

  raw(key: string): string | null {
    return this.lines.get(key) ?? null;
  }
}

const CHILD = "viewer-note-a";
const OTHER = "viewer-doc-7";

describe("the lines a window writes", () => {
  test("a window's document is readable by every other window", () => {
    const storage = new MemoryStorage();
    recordViewer(CHILD, "/tmp/chapter-3.pdf", 1000, storage);

    expect(listViewers(storage)).toEqual([
      { label: CHILD, filePath: "/tmp/chapter-3.pdf", usedAt: 1000 },
    ]);
  });

  test("each window has a line of its own, so a write cannot drop another's", () => {
    const storage = new MemoryStorage();
    recordViewer(CHILD, "/tmp/a.pdf", 1000, storage);
    recordViewer(OTHER, "/tmp/b.pdf", 2000, storage);

    expect(listViewers(storage)).toEqual([
      { label: CHILD, filePath: "/tmp/a.pdf", usedAt: 1000 },
      { label: OTHER, filePath: "/tmp/b.pdf", usedAt: 2000 },
    ]);
  });

  test("a window that opens another document replaces its own line", () => {
    const storage = new MemoryStorage();
    recordViewer(CHILD, "/tmp/a.pdf", 1000, storage);
    recordViewer(CHILD, "/tmp/b.pdf", 2000, storage);

    expect(listViewers(storage)).toEqual([
      { label: CHILD, filePath: "/tmp/b.pdf", usedAt: 2000 },
    ]);
  });

  test("a window with no document withdraws its line, and nobody else's", () => {
    const storage = new MemoryStorage();
    recordViewer(CHILD, "/tmp/a.pdf", 1000, storage);
    recordViewer(OTHER, "/tmp/b.pdf", 2000, storage);

    withdrawViewer(CHILD, storage);

    expect(listViewers(storage)).toEqual([
      { label: OTHER, filePath: "/tmp/b.pdf", usedAt: 2000 },
    ]);
  });

  test("being asked for a passage makes a window the most recently used", () => {
    const storage = new MemoryStorage();
    recordViewer(CHILD, "/tmp/a.pdf", 1000, storage);
    recordViewer(OTHER, "/tmp/b.pdf", 2000, storage);

    touchViewer(CHILD, 3000, storage);

    expect(listViewers(storage)).toEqual([
      { label: CHILD, filePath: "/tmp/a.pdf", usedAt: 3000 },
      { label: OTHER, filePath: "/tmp/b.pdf", usedAt: 2000 },
    ]);
  });

  test("touching a window that has no line writes nothing", () => {
    const storage = new MemoryStorage();
    touchViewer(CHILD, 3000, storage);
    expect(listViewers(storage)).toEqual([]);
  });

  test("keys this module does not own are left alone", () => {
    const storage = new MemoryStorage();
    storage.setForeign("lumen-prefs-v1", "{\"stripBase\":160}");
    recordViewer(CHILD, "/tmp/a.pdf", 1000, storage);

    expect(listViewers(storage)).toHaveLength(1);
    expect(storage.raw("lumen-prefs-v1")).toBe("{\"stripBase\":160}");
  });
});

describe("a line that cannot be trusted is ignored", () => {
  test("not JSON at all", () => {
    const storage = new MemoryStorage();
    storage.setItem("open-viewers-v1:viewer-note-a", "not json");
    expect(listViewers(storage)).toEqual([]);
  });

  test("the wrong shape", () => {
    const storage = new MemoryStorage();
    for (const value of ["null", "[]", "\"a.pdf\"", "{}", "{\"label\":\"a\"}"]) {
      storage.setItem("open-viewers-v1:viewer-note-a", value);
      expect(listViewers(storage)).toEqual([]);
    }
    storage.setItem(
      "open-viewers-v1:viewer-note-a",
      JSON.stringify({ label: CHILD, filePath: "", usedAt: 1 }),
    );
    expect(listViewers(storage)).toEqual([]);
    storage.setItem(
      "open-viewers-v1:viewer-note-a",
      JSON.stringify({ label: CHILD, filePath: "/tmp/a.pdf", usedAt: Number.NaN }),
    );
    expect(listViewers(storage)).toEqual([]);
  });

  test("a value filed under another window's label names no window", () => {
    // A label is the address a message is sent to: the line's own key is the only
    // one that may decide it.
    const storage = new MemoryStorage();
    storage.setItem(
      "open-viewers-v1:viewer-note-a",
      JSON.stringify({ label: OTHER, filePath: "/tmp/a.pdf", usedAt: 1 }),
    );
    expect(listViewers(storage)).toEqual([]);
  });

  test("a storage that cannot be read is a storage with no windows", () => {
    const broken: ViewerRegistryStorage = {
      get length(): number {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(listViewers(broken)).toEqual([]);
    // Writing and withdrawing resolve instead of throwing: the click that asked
    // for this simply opens a window.
    expect(() => recordViewer(CHILD, "/tmp/a.pdf", 1, broken)).not.toThrow();
    expect(() => touchViewer(CHILD, 2, broken)).not.toThrow();
    expect(() => withdrawViewer(CHILD, broken)).not.toThrow();
    expect(() => pruneViewers([CHILD], broken)).not.toThrow();
  });
});

describe("pruneViewers", () => {
  test("reclaims the lines of windows that are gone", () => {
    const storage = new MemoryStorage();
    recordViewer(CHILD, "/tmp/a.pdf", 1000, storage);
    recordViewer(OTHER, "/tmp/b.pdf", 2000, storage);

    pruneViewers([OTHER], storage);

    expect(listViewers(storage)).toEqual([
      { label: OTHER, filePath: "/tmp/b.pdf", usedAt: 2000 },
    ]);
  });

  test("keeps every window Tauri still has, even with no document", () => {
    const storage = new MemoryStorage();
    recordViewer(CHILD, "/tmp/a.pdf", 1000, storage);

    pruneViewers([CHILD, "main", "notes"], storage);

    expect(listViewers(storage)).toHaveLength(1);
  });
});

describe("viewerShowing", () => {
  const viewers: OpenViewer[] = [
    { label: "viewer-note-a", filePath: "/tmp/a.pdf", usedAt: 1000 },
    { label: "viewer-doc-7", filePath: "/tmp/a.pdf", usedAt: 3000 },
    { label: "app-m1", filePath: "/tmp/b.pdf", usedAt: 5000 },
    { label: "main", filePath: "/tmp/a.pdf", usedAt: 9000 },
  ];
  const live = ["main", "notes", "viewer-note-a", "viewer-doc-7", "app-m1"];

  test("picks a window on that document", () => {
    expect(viewerShowing([viewers[2]], "/tmp/b.pdf", live)?.label).toBe("app-m1");
  });

  test("ignores windows showing another document", () => {
    expect(viewerShowing([viewers[0]], "/tmp/b.pdf", live)).toBeNull();
  });

  test("ignores the original window: a reference is read beside it", () => {
    expect(viewerShowing([viewers[3]], "/tmp/a.pdf", live, ["main"])).toBeNull();
    // It is left out and the subwindows are still candidates.
    expect(viewerShowing(viewers, "/tmp/a.pdf", live, ["main"])?.label).toBe("viewer-doc-7");
  });

  test("ignores a window Tauri no longer has, however new its line", () => {
    expect(viewerShowing([viewers[1]], "/tmp/a.pdf", ["main", "viewer-note-a"], ["main"]))
      .toBeNull();
  });

  test("the most recently used window wins", () => {
    expect(viewerShowing(viewers, "/tmp/a.pdf", live, ["main"])?.label).toBe("viewer-doc-7");
    const touched = viewers.map((viewer) =>
      viewer.label === "viewer-note-a" ? { ...viewer, usedAt: 10_000 } : viewer,
    );
    expect(viewerShowing(touched, "/tmp/a.pdf", live, ["main"])?.label).toBe("viewer-note-a");
  });

  test("a window closed and reopened is found by its new label", () => {
    // Nothing is remembered across windows: the candidate is the window, not the
    // document.
    const reopened: OpenViewer[] = [{ label: "viewer-note-b", filePath: "/tmp/a.pdf", usedAt: 1 }];
    expect(viewerShowing(reopened, "/tmp/a.pdf", ["viewer-note-a"], ["main"])).toBeNull();
    expect(viewerShowing(reopened, "/tmp/a.pdf", ["viewer-note-b"], ["main"])?.label)
      .toBe("viewer-note-b");
  });
});

describe("referencePlacement", () => {
  const live = ["main", "notes", "viewer-note-a", "viewer-doc-7", "app-m1"];
  const exclude = ["main"];

  /** A viewer window's line, as publishing its document leaves it. */
  const line = (label: string, filePath: string, usedAt = 1000): OpenViewer => ({
    label,
    filePath,
    usedAt,
  });

  test("the window the click happened in answers when it has the document", () => {
    // The reader is in a reference viewer on /a.pdf and clicks a note of /a.pdf.
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "viewer-note-a", filePath: "/a.pdf" },
        viewers: [line("viewer-note-a", "/a.pdf")],
        live,
        exclude,
      }),
    ).toEqual({ kind: "here" });
  });

  test("the window the click happened in answers even when another has it too", () => {
    // The band moves where the reader is looking, not in the window last used.
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "viewer-doc-7", filePath: "/a.pdf" },
        viewers: [line("viewer-doc-7", "/a.pdf", 1000), line("viewer-note-a", "/a.pdf", 9000)],
        live,
        exclude,
      }),
    ).toEqual({ kind: "here" });
  });

  test("the original window never answers, even on its own document", () => {
    // The stated rule: the same PDF may be open in the main window and in a
    // subwindow, and a click in the main window belongs to the subwindow.
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "main", filePath: "/a.pdf" },
        viewers: [line("main", "/a.pdf"), line("viewer-note-a", "/a.pdf")],
        live,
        exclude,
      }),
    ).toEqual({ kind: "window", label: "viewer-note-a" });
  });

  test("the original window opens one when nothing has the document", () => {
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "main", filePath: "/b.pdf" },
        viewers: [line("viewer-note-a", "/c.pdf")],
        live,
        exclude,
      }),
    ).toEqual({ kind: "open" });
  });

  test("a pin's click is answered in the original window when it has the document", () => {
    // A pin is a place on the page the reader is already looking at, so a
    // reference to one scrolls that page instead of stacking a viewer beside it.
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "main", filePath: "/a.pdf" },
        viewers: [line("main", "/a.pdf"), line("viewer-note-a", "/a.pdf")],
        live,
        exclude,
        selfMayAnswer: true,
      }),
    ).toEqual({ kind: "here" });
  });

  test("selfMayAnswer lets only the clicked window answer for itself", () => {
    // The same option does not make an excluded window a candidate for a click
    // made somewhere else: the notes window asks, and the main window is still
    // never told to stand on a passage by a reference clicked away from it.
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "notes", filePath: null },
        viewers: [line("main", "/a.pdf")],
        live,
        exclude,
        selfMayAnswer: true,
      }),
    ).toEqual({ kind: "open" });
  });

  test("a subwindow with the document is used instead of opening a second", () => {
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "viewer-note-a", filePath: "/b.pdf" },
        viewers: [line("viewer-doc-7", "/a.pdf")],
        live,
        exclude,
      }),
    ).toEqual({ kind: "window", label: "viewer-doc-7" });
  });

  test("the most recently used of several is the one asked", () => {
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "app-m1", filePath: "/b.pdf" },
        viewers: [line("viewer-note-a", "/a.pdf", 1000), line("viewer-doc-7", "/a.pdf", 5000)],
        live,
        exclude,
      }),
    ).toEqual({ kind: "window", label: "viewer-doc-7" });
  });

  test("a line naming a window that is gone is not a candidate", () => {
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "main", filePath: "/b.pdf" },
        viewers: [line("viewer-note-a", "/a.pdf")],
        live: ["main", "notes"],
        exclude,
      }),
    ).toEqual({ kind: "open" });
  });

  test("a window's own stale line is not sent to that window", () => {
    // It published /a.pdf and then opened /b.pdf without the withdraw landing:
    // asking it to stand on an /a.pdf strip would park a band on the wrong paper.
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "viewer-note-a", filePath: "/b.pdf" },
        viewers: [line("viewer-note-a", "/a.pdf")],
        live,
        exclude,
      }),
    ).toEqual({ kind: "open" });
  });

  test("a pathless document is nobody's", () => {
    // A PDF opened from bytes has no library path, so no line can match it and the
    // window the click happened in has no document to stand a band on.
    expect(
      referencePlacement({
        filePath: "/a.pdf",
        self: { label: "viewer-note-a", filePath: null },
        viewers: [line("viewer-note-a", "/b.pdf")],
        live,
        exclude,
      }),
    ).toEqual({ kind: "open" });
  });
});
