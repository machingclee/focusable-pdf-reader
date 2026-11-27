import { AnnotationLayer, AnnotationType, GlobalWorkerOptions, getDocument, TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { isOpenablePdfUrl } from "./pdfLinks";
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

/**
 * Open a PDF without touching its pages.
 *
 * The notes list only needs one band from one page, so it must not pay for the
 * text extraction `loadPdfFromBytes` does for the viewer; sharing the call here
 * keeps the worker, CMaps and standard-font URLs identical between the two.
 */
export async function openPdfDocument(data: Uint8Array): Promise<PDFDocumentProxy> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return getDocument({
    data: copy,
    useSystemFonts: true,
    cMapUrl: pdfAssetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfAssetUrl("standard_fonts"),
  }).promise;
}

export async function loadPdfFromBytes(
  data: Uint8Array,
  sourceName: string,
): Promise<LoadedPdf> {
  const document = await openPdfDocument(data);

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
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));

      /* Paint into a canvas of its own, then hand the finished bitmap over in one
         step. Assigning `canvas.width` clears the visible canvas, so rendering in
         place empties the page for as long as pdf.js takes — and with `alpha:
         false` the empty surface is black, so every zoom step flashed the pages
         black. `renderZoom` is debounced, so this costs one extra buffer per
         settled zoom rather than one per frame. */
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      const context = scratch.getContext("2d", { alpha: false });
      if (!context) return;

      task = pdfPage.render({
        canvasContext: context,
        canvas: scratch,
        viewport,
      });
      await task.promise;
      if (cancelled || !canvas.isConnected) return;

      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d", { alpha: false })?.drawImage(scratch, 0, 0);
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

/**
 * What a click on a link annotation does. The rectangles are pdf.js's; the
 * viewer supplies the jump, so a destination scrolls this document and a URL
 * is handed to the OS instead of navigating the webview.
 */
export type PdfLinkActions = {
  goToDestination: (dest: unknown) => void;
  executeNamedAction: (action: string) => void;
  openExternal: (url: string) => void;
};

function linkServiceFor(actions: { readonly current: PdfLinkActions }) {
  return {
    addLinkAttributes(link: HTMLAnchorElement, url: string) {
      // Never a real href. In this webview a navigation replaces the viewer.
      link.href = "#";
      link.title = url;
      link.rel = "noopener noreferrer nofollow";
      link.onclick = (event: MouseEvent) => {
        event.preventDefault();
        if (isOpenablePdfUrl(url)) actions.current.openExternal(url);
        return false;
      };
    },
    getDestinationHash() {
      return "#";
    },
    getAnchorUrl() {
      return "#";
    },
    goToDestination(dest: unknown) {
      actions.current.goToDestination(dest);
    },
    executeNamedAction(action: string) {
      actions.current.executeNamedAction(action);
    },
    async getAttachmentContent() {
      return null;
    },
    executeSetOCGState() {},
  };
}

function isLinkAnnotation(item: { annotationType?: number; subtype?: string }): boolean {
  return item.annotationType === AnnotationType.LINK || item.subtype === "Link";
}

/**
 * Paint the page's link annotations over the text layer.
 *
 * The rectangles are percentages of this box, and the box fills the page
 * shell, so a zoom tick does not rebuild them. pdf.js sizes the layer in its
 * own pixels; that size is cleared so the shell's box is the one that counts.
 * Only link annotations are drawn — highlights and form fields belong to
 * other layers this viewer already has.
 */
export function renderPageAnnotationLayer(
  pdfPage: PDFPageProxy,
  container: HTMLDivElement,
  actions: { readonly current: PdfLinkActions },
): { cancel: () => void } {
  let cancelled = false;
  let layer: AnnotationLayer | null = null;
  let stopClick: (() => void) | undefined;

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("a")) return;
    // The anchors point at "#". Following that would scroll the webview.
    event.preventDefault();
  };

  void (async () => {
    const annotations = await pdfPage.getAnnotations({ intent: "display" });
    if (cancelled || !container.isConnected) return;
    const links = annotations.filter(isLinkAnnotation);
    container.replaceChildren();
    container.style.width = "";
    container.style.height = "";
    if (links.length === 0) return;

    const viewport = pdfPage.getViewport({ scale: 1 });
    const linkService = linkServiceFor(actions);
    const built = new AnnotationLayer({
      div: container,
      accessibilityManager: null,
      annotationCanvasMap: null,
      annotationEditorUIManager: null,
      page: pdfPage,
      viewport,
      structTreeLayer: null,
      commentManager: null,
      linkService,
      annotationStorage: null,
    });
    layer = built;
    if (cancelled) {
      built.destroy();
      return;
    }
    await built.render({
      viewport,
      div: container,
      annotations: links,
      page: pdfPage,
      linkService: linkService as never,
      renderForms: false,
      enableScripting: false,
    });
    if (cancelled || !container.isConnected) {
      built.destroy();
      return;
    }
    container.style.width = "";
    container.style.height = "";
    container.addEventListener("click", onClick, true);
    stopClick = () => container.removeEventListener("click", onClick, true);
  })().catch((cause: unknown) => {
    if (!cancelled) console.error(cause);
  });

  return {
    cancel: () => {
      cancelled = true;
      stopClick?.();
      stopClick = undefined;
      layer?.destroy();
      layer = null;
    },
  };
}
