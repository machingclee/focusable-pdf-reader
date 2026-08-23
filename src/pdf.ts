import { GlobalWorkerOptions, getDocument, TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** WKWebView's `for await (... of readableStream)` calls `.values()`, which JSC lacks. */
function installReadableStreamAsyncIteratorPolyfill() {
  const proto = ReadableStream.prototype as ReadableStream<unknown> & {
    values?: () => AsyncIterableIterator<unknown>;
    [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>;
  };
  if (typeof proto.values === "function" && typeof proto[Symbol.asyncIterator] === "function") {
    return;
  }

  const values = function values(this: ReadableStream<unknown>) {
    const reader = this.getReader();
    const iterator = {
      next: () => reader.read() as Promise<IteratorResult<unknown>>,
      return: async () => {
        try {
          await reader.cancel();
        } catch {
          // already closed
        }
        try {
          reader.releaseLock();
        } catch {
          // already released
        }
        return { done: true as const, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    return iterator as AsyncIterableIterator<unknown>;
  };

  proto.values = values;
  proto[Symbol.asyncIterator] ??= values;
}

installReadableStreamAsyncIteratorPolyfill();

function pdfAssetUrl(kind: "cmaps" | "standard_fonts"): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/pdfjs/${kind}/`;
}

const pageLocks = new WeakMap<PDFPageProxy, Promise<void>>();

function isCancelledRender(cause: unknown): boolean {
  const name = cause && typeof cause === "object" && "name" in cause ? String(cause.name) : "";
  return name === "RenderingCancelledException";
}

export type SearchBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TextRun = {
  start: number;
  end: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PageTextIndex = {
  pageIndex: number;
  fullText: string;
  runs: TextRun[];
};

type PageTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

export type LoadedPage = {
  index: number;
  pdfPage: PDFPageProxy;
  width: number;
  height: number;
  text: PageTextIndex;
  textContent: PageTextContent;
};

export type LoadedPdf = {
  sourceName: string;
  document: PDFDocumentProxy;
  pages: LoadedPage[];
};

export async function loadPdfFromBytes(
  data: Uint8Array,
  sourceName: string,
): Promise<LoadedPdf> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);

  const document = await getDocument({
    data: copy,
    useSystemFonts: true,
    cMapUrl: pdfAssetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfAssetUrl("standard_fonts"),
  }).promise;

  const pages: LoadedPage[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const pdfPage = await document.getPage(index);
    patchGetTextContent(pdfPage);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const textContent = await readPageTextContent(pdfPage);
    pages.push({
      index,
      pdfPage,
      width: viewport.width,
      height: viewport.height,
      textContent,
      text: extractPageText(textContent, index, viewport.width, viewport.height, pdfPage),
    });
  }

  return { sourceName, document, pages };
}

let getTextContentPatched = false;

function patchGetTextContent(page: PDFPageProxy) {
  if (getTextContentPatched) return;
  const proto = Object.getPrototypeOf(page) as PDFPageProxy & { getTextContent: PDFPageProxy["getTextContent"] };
  proto.getTextContent = function patchedGetTextContent(params = {}) {
    return consumeTextContentStream(this.streamTextContent(params));
  };
  getTextContentPatched = true;
}

async function consumeTextContentStream(stream: ReadableStream): Promise<PageTextContent> {
  const textContent: PageTextContent = {
    items: [],
    styles: Object.create(null),
    lang: null,
  };
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      textContent.lang ??= value.lang ?? null;
      Object.assign(textContent.styles, value.styles);
      textContent.items.push(...value.items);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
  return textContent;
}

async function readPageTextContent(pdfPage: PDFPageProxy): Promise<PageTextContent> {
  try {
    return await consumeTextContentStream(
      pdfPage.streamTextContent({
        includeMarkedContent: true,
        disableNormalization: true,
      }),
    );
  } catch (cause) {
    console.error("Failed to read page text content", cause);
    return { items: [], styles: Object.create(null), lang: null };
  }
}

function isTextItem(item: unknown): item is {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
} {
  return Boolean(item && typeof item === "object" && "str" in item && "transform" in item);
}

function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function extractPageText(
  content: Awaited<ReturnType<PDFPageProxy["getTextContent"]>>,
  pageIndex: number,
  fallbackWidth: number,
  fallbackHeight: number,
  pdfPage: PDFPageProxy,
): PageTextIndex {
  try {
    const viewport = pdfPage.getViewport({ scale: 1 });
    let fullText = "";
    const runs: TextRun[] = [];

    for (const item of content.items) {
      if (!isTextItem(item)) continue;
      const str = item.str;
      if (!str) {
        if (item.hasEOL) fullText += "\n";
        continue;
      }

      const start = fullText.length;
      fullText += str;
      try {
        const tx = multiply(viewport.transform, item.transform);
        const fontHeight = Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || item.height || 10;
        const width = item.width || fontHeight * Math.max(1, str.length * 0.5);
        runs.push({
          start,
          end: start + str.length,
          left: clampBox(tx[4] ?? 0, fallbackWidth),
          top: clampBox((tx[5] ?? 0) - fontHeight, fallbackHeight),
          width: Math.max(4, width),
          height: Math.max(10, fontHeight * 1.2),
        });
      } catch {
        // Keep the searchable text even if this glyph has no usable box.
      }
      if (item.hasEOL) fullText += "\n";
    }

    return { pageIndex, fullText, runs };
  } catch (cause) {
    console.error(`Failed to extract text for page ${pageIndex}`, cause);
    return { pageIndex, fullText: "", runs: [] };
  }
}

function clampBox(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), Math.max(0, max));
}

export function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** pdf.js allows only one live render per page; queue and cancel safely. */
export function renderPageToCanvas(
  pdfPage: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
): { cancel: () => void } {
  let cancelled = false;
  let task: RenderTask | null = null;

  const previous = pageLocks.get(pdfPage) ?? Promise.resolve();
  let releaseLock = () => {};
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  pageLocks.set(pdfPage, currentLock);

  void previous
    .catch(() => undefined)
    .then(async () => {
      if (cancelled || !canvas.isConnected) return;

      const dpr = window.devicePixelRatio || 1;
      const viewport = pdfPage.getViewport({ scale: scale * dpr });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;

      task = pdfPage.render({
        canvasContext: context,
        canvas,
        viewport,
      });
      await task.promise;
    })
    .catch((cause: unknown) => {
      if (!isCancelledRender(cause)) {
        console.error(cause);
      }
    })
    .finally(() => {
      releaseLock();
    });

  return {
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}

const textLayerEnds = new Map<HTMLElement, HTMLElement>();
let textSelectionAbort: AbortController | null = null;

function resetTextLayerSelection(end: HTMLElement, layer: HTMLElement) {
  if (end.parentNode !== layer) layer.append(end);
  end.style.width = "";
  end.style.height = "";
  layer.classList.remove("selecting");
}

function ensureTextSelectionListener() {
  if (textSelectionAbort) return;
  textSelectionAbort = new AbortController();
  const { signal } = textSelectionAbort;

  const resetAll = () => {
    textLayerEnds.forEach(resetTextLayerSelection);
  };
  document.addEventListener("pointerup", resetAll, { signal });
  window.addEventListener("blur", resetAll, { signal });
  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      resetAll();
      return;
    }
    const active = new Set<HTMLElement>();
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      for (const layer of textLayerEnds.keys()) {
        if (range.intersectsNode(layer)) active.add(layer);
      }
    }
    for (const [layer, end] of textLayerEnds) {
      if (active.has(layer)) layer.classList.add("selecting");
      else resetTextLayerSelection(end, layer);
    }
  }, { signal });
}

function bindTextLayerSelection(container: HTMLElement): () => void {
  const end = document.createElement("div");
  end.className = "endOfContent";
  container.append(end);
  const onMouseDown = () => container.classList.add("selecting");
  container.addEventListener("mousedown", onMouseDown);
  textLayerEnds.set(container, end);
  ensureTextSelectionListener();
  return () => {
    container.removeEventListener("mousedown", onMouseDown);
    textLayerEnds.delete(container);
    end.remove();
    container.classList.remove("selecting");
  };
}

export function renderPageTextLayer(
  pdfPage: PDFPageProxy,
  container: HTMLElement,
  textContent: PageTextContent,
): { cancel: () => void } {
  let cancelled = false;
  let layer: TextLayer | null = null;
  let unbind: (() => void) | undefined;

  void (async () => {
    if (cancelled || !container.isConnected) return;
    container.replaceChildren();
    layer = new TextLayer({
      textContentSource: textContent,
      container,
      viewport: pdfPage.getViewport({ scale: 1 }),
    });
    await layer.render();
    if (cancelled || !container.isConnected) {
      layer.cancel();
      return;
    }
    unbind = bindTextLayerSelection(container);
  })().catch((cause: unknown) => {
    if (!cancelled) console.error(cause);
  });

  return {
    cancel: () => {
      cancelled = true;
      unbind?.();
      unbind = undefined;
      layer?.cancel();
    },
  };
}
