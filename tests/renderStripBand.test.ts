import { describe, expect, mock, test } from "bun:test";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * `notesPreview` imports `./pdf`, which pulls pdf.js's worker through Vite's
 * `?url` — an import the test runner cannot resolve. Nothing here needs a real
 * document: the question is only whether the painter agrees to paint.
 */
mock.module("../src/pdf", () => ({
  openPdfDocument: () => {
    throw new Error("this test never opens a document");
  },
}));

const { renderStripBand } = await import("../src/notesPreview");

const BAND = { page_number: 1, top: 100, height: 50, page_width: 595 };
const TARGET_WIDTH = 300;

type Log = { renders: number; calls: string[] };

function fakeCanvas(log: Log): HTMLCanvasElement {
  const context = {
    fillStyle: "",
    fillRect: (_x: number, _y: number, width: number, height: number) => {
      log.calls.push(`fillRect ${width}x${height}`);
    },
    translate: (x: number, y: number) => {
      log.calls.push(`translate ${x},${y}`);
    },
    save: () => {
      log.calls.push("save");
    },
    restore: () => {
      log.calls.push("restore");
    },
  };
  return {
    width: 0,
    height: 0,
    // The HTML export paints into a canvas it never attaches, then reads the
    // pixels back with `toDataURL`. This false is the regression: the painter used
    // to treat a detached canvas as one nobody wanted, so every exported
    // thumbnail came out blank.
    isConnected: false,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
}

function fakeDocument(log: Log): PDFDocumentProxy {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => {
      log.renders += 1;
      return { promise: Promise.resolve(), cancel: () => undefined };
    },
  };
  return { getPage: async () => page } as unknown as PDFDocumentProxy;
}

function setup(): { log: Log; canvas: HTMLCanvasElement; document: PDFDocumentProxy } {
  const log: Log = { renders: 0, calls: [] };
  return { log, canvas: fakeCanvas(log), document: fakeDocument(log) };
}

describe("renderStripBand", () => {
  test("paints a canvas that is not in the document", async () => {
    const { log, canvas, document } = setup();
    await renderStripBand(canvas, document, BAND, TARGET_WIDTH).promise;

    expect(log.renders).toBe(1);
    // The band is laid out at the asked-for width, in the band's own aspect ratio.
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(25);
    // Paper first, then the band shifted up to the canvas origin.
    expect(log.calls).toContain("fillRect 300x25");
    expect(log.calls).toContain("translate 0,-50.42016806722689");
    // The shift is only for the page paint. The context is put back, so a
    // highlight drawn next is in canvas pixels.
    expect(log.calls.at(-1)).toBe("restore");
  });

  test("cancelling before the queued paint starts stops it", async () => {
    const { log, canvas, document } = setup();
    const render = renderStripBand(canvas, document, BAND, TARGET_WIDTH);
    // `cancel` has to reach the queued work: the render task does not exist yet,
    // so cancelling the task alone would let the paint run anyway.
    render.cancel();

    let error: unknown = null;
    try {
      await render.promise;
    } catch (cause) {
      error = cause;
    }
    expect(log.renders).toBe(0);
    expect((error as Error).name).toBe("RenderingCancelledException");
  });
});
