/**
 * Strip thumbnails for the Notes tab, rendered from the PDF itself.
 *
 * A saved strip is a page number plus a band of that page in PDF points, so the
 * notes list does not need a stored picture: it can render the page small and
 * show only the band. That keeps the database free of duplicated pixels, keeps
 * the thumbnail as sharp as the document, and means a strip saved at 400 % zoom
 * looks exactly like one saved at 100 %.
 *
 * Two consequences worth naming:
 *
 *  - the file has to be reachable. A moved or deleted PDF simply has no
 *    thumbnail; the row falls back to its text excerpt (the component handles
 *    that, this module just rejects).
 *  - reading a book-sized PDF costs ~100-200 ms, so documents are cached across
 *    rows and tab switches (LRU, disposed on eviction), and rows only render
 *    once they scroll into view.
 *
 * The crop keeps the page's **full width** and only the strip's height: a narrow
 * column crop is unreadable at thumbnail size, while the full-width band still
 * reads as the shape of the page at that place.
 */
import { readFile } from "@tauri-apps/plugin-fs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdfDocument } from "./pdf";
import { stripBandLayout } from "./stripBand";

/** Open documents kept in memory. Three covers "click through a few documents". */
const MAX_CACHED_DOCUMENTS = 3;

type CacheEntry = {
  promise: Promise<PDFDocumentProxy>;
  usedAt: number;
};

const documents = new Map<string, CacheEntry>();

async function openDocument(path: string): Promise<PDFDocumentProxy> {
  const bytes = await readFile(path);
  return openPdfDocument(bytes);
}

/**
 * Cached document for `path`, opened on first use.
 *
 * Failures are not cached: a file that is temporarily unreadable should be
 * retried the next time a row asks for it, not remembered as broken.
 */
export function getPreviewDocument(path: string): Promise<PDFDocumentProxy> {
  const hit = documents.get(path);
  if (hit) {
    hit.usedAt = Date.now();
    return hit.promise;
  }

  const entry: CacheEntry = { promise: openDocument(path), usedAt: Date.now() };
  entry.promise.catch(() => {
    if (documents.get(path) === entry) documents.delete(path);
  });
  documents.set(path, entry);

  if (documents.size > MAX_CACHED_DOCUMENTS) {
    let oldestPath: string | null = null;
    let oldestAt = Infinity;
    for (const [candidate, candidateEntry] of documents) {
      if (candidate === path) continue;
      if (candidateEntry.usedAt < oldestAt) {
        oldestAt = candidateEntry.usedAt;
        oldestPath = candidate;
      }
    }
    if (oldestPath !== null) {
      const evicted = documents.get(oldestPath);
      documents.delete(oldestPath);
      // `destroy` frees the worker-side document and its parsed page tree.
      void evicted?.promise
        // `destroy()` lives on the loading task in pdfjs-dist 6; the document
        // proxy only allows `cleanup()`, which would leave the worker-side copy
        // of a whole PDF alive.
        .then((document) => document.loadingTask.destroy())
        .catch(() => undefined);
    }
  }

  return entry.promise;
}

export type BandRender = {
  /** Resolves when the band is painted, or rejects if the render was cancelled. */
  promise: Promise<void>;
  cancel: () => void;
};

/**
 * pdf.js allows one live `render` per page object. Strip thumbnails and the
 * document hover preview share one cached document, so a page-1 strip and the
 * first-page popover would otherwise start two renders of the same page.
 */
const pageRenderChain = new WeakMap<object, Promise<void>>();

function enqueuePageRender(page: object, work: () => Promise<void>): Promise<void> {
  const previous = pageRenderChain.get(page) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  pageRenderChain.set(page, run.then(() => undefined, () => undefined));
  return run;
}

/**
 * Paint `strip`'s band into `canvas` at `targetWidthPx` wide.
 *
 * The render is offset so the band lands at the canvas origin; pdf.js clips the
 * rest of the page away, so the canvas — not the page — is what the browser
 * keeps in memory.
 */
export function renderStripBand(
  canvas: HTMLCanvasElement,
  document: PDFDocumentProxy,
  band: { page_number: number; top: number; height: number; page_width: number },
  targetWidthPx: number,
): BandRender {
  let task: { cancel: () => void } | null = null;

  const promise = (async () => {
    const page = await document.getPage(band.page_number);
    const base = page.getViewport({ scale: 1 });
    const pageWidth = band.page_width > 0 ? band.page_width : base.width;
    const layout = stripBandLayout(pageWidth, { top: band.top, height: band.height }, targetWidthPx);

    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("A 2D canvas context is required for a strip thumbnail.");

    // PDF pages are paper: paint white first, otherwise the transparent canvas
    // shows the app's dark surface through the glyph gaps.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, layout.width, layout.height);
    context.translate(0, layout.translateY);

    const viewport = page.getViewport({ scale: layout.scale });
    await enqueuePageRender(page, async () => {
      if (!canvas.isConnected) return;
      const renderTask = page.render({ canvasContext: context, canvas, viewport });
      task = renderTask;
      await renderTask.promise;
    });
  })();

  return {
    promise,
    cancel: () => task?.cancel(),
  };
}

/**
 * Paint one whole page into `canvas`, `targetWidthPx` wide.
 *
 * The height follows the page, so a landscape sheet stays short and a letter
 * page stays tall. Device pixels stop at 2×: a hover preview is glanced at,
 * and a 3× buffer of a full page is a lot of bitmap for that.
 */
export function renderPreviewPage(
  canvas: HTMLCanvasElement,
  document: PDFDocumentProxy,
  pageNumber: number,
  targetWidthPx: number,
): BandRender {
  let cancelled = false;
  let task: { cancel: () => void } | null = null;

  const promise = (async () => {
    const page = await document.getPage(pageNumber);
    if (cancelled) throw Object.assign(new Error("cancelled"), { name: "RenderingCancelledException" });

    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (targetWidthPx / base.width) * dpr });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("A 2D canvas context is required for a page preview.");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await enqueuePageRender(page, async () => {
      if (cancelled || !canvas.isConnected) return;
      const renderTask = page.render({ canvasContext: context, canvas, viewport });
      task = renderTask;
      await renderTask.promise;
    });
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}
