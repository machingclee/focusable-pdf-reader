/**
 * Where a PDF link annotation points, and whether a URL on one may leave the app.
 *
 * The page paints its own link rectangles (pdf.js annotation layer). This module
 * only decides what a click means: an internal destination becomes a page and a
 * point on that page, in the same CSS pixels the page box uses at zoom 1.
 */

export type PdfDestPoint = {
  left: number;
  top: number;
};

export type PdfDestTarget = {
  /** 1-based, matching `[data-page]`. */
  pageNumber: number;
  /** `null` asks for the top of the page (Fit / FitB). */
  point: PdfDestPoint | null;
};

type DestRef = { num: number; gen: number };

/** The document calls a destination needs. A loaded pdf.js document satisfies this. */
export type PdfDestDocument = {
  numPages: number;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: DestRef): Promise<number>;
  cachedPageNumber(ref: DestRef): number | null;
};

/** Enough of a page to turn a PDF user-space point into the page box. */
export type DestPage = {
  getViewport(params: { scale: number }): {
    width: number;
    height: number;
    rotation: number;
    convertToViewportPoint(x: number, y: number): number[];
  };
};

const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "file:"]);

/**
 * A URL the webview must not navigate to itself. `javascript:` and anything
 * that is not absolute stay inside the viewer and do nothing.
 */
export function isOpenablePdfUrl(url: string): boolean {
  try {
    return OPENABLE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function destKind(spec: unknown): string | null {
  if (typeof spec === "string") return spec;
  if (spec && typeof spec === "object" && "name" in spec) {
    const name = (spec as { name: unknown }).name;
    if (typeof name === "string") return name;
  }
  return null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The point an explicit destination wants at the top of the window.
 *
 * Coordinates are CSS px on the page at zoom 1. `null` means the top of the
 * page: Fit and FitB name no point. The page's own viewport does the Y flip,
 * so a crop box that does not start at the origin still lands on the words.
 */
export function destinationScrollPoint(
  dest: readonly unknown[],
  page: DestPage,
): PdfDestPoint | null {
  const kind = destKind(dest[1]);
  if (!kind) return null;

  const viewport = page.getViewport({ scale: 1 });
  const swapped = viewport.rotation % 180 !== 0;
  const pageHeight = swapped ? viewport.width : viewport.height;

  const place = (x: number, y: number): PdfDestPoint => {
    const [vx, vy] = viewport.convertToViewportPoint(x, y);
    return { left: Math.max(0, vx), top: Math.max(0, vy) };
  };

  switch (kind) {
    case "XYZ": {
      const x = finite(dest[2]) ?? 0;
      const y = finite(dest[3]) ?? pageHeight;
      return place(x, y);
    }
    case "Fit":
    case "FitB":
      return null;
    case "FitH":
    case "FitBH": {
      const y = finite(dest[2]);
      return place(0, y !== null && y >= 0 ? y : pageHeight);
    }
    case "FitV":
    case "FitBV":
      return place(finite(dest[2]) ?? 0, pageHeight);
    case "FitR": {
      const x1 = finite(dest[2]) ?? 0;
      const y1 = finite(dest[3]) ?? 0;
      const x2 = finite(dest[4]) ?? x1;
      const y2 = finite(dest[5]) ?? y1;
      const a = place(x1, y1);
      const b = place(x2, y2);
      return {
        left: Math.min(a.left, b.left),
        top: Math.min(a.top, b.top),
      };
    }
    default:
      return null;
  }
}

function isDestRef(value: unknown): value is DestRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as { num?: unknown; gen?: unknown };
  return typeof ref.num === "number" && typeof ref.gen === "number";
}

async function pageNumberForRef(
  document: PdfDestDocument,
  ref: unknown,
): Promise<number | null> {
  const count = document.numPages;
  const accept = (pageNumber: number) =>
    pageNumber >= 1 && pageNumber <= count ? pageNumber : null;

  if (typeof ref === "number" && Number.isInteger(ref)) return accept(ref + 1);
  if (!isDestRef(ref)) return null;

  const cached = document.cachedPageNumber(ref);
  if (typeof cached === "number" && cached >= 1) return accept(cached);
  try {
    return accept((await document.getPageIndex(ref)) + 1);
  } catch {
    return null;
  }
}

async function explicitDestination(
  document: PdfDestDocument,
  dest: unknown,
): Promise<unknown[] | null> {
  let value = dest;
  if (value && typeof (value as { then?: unknown }).then === "function") {
    value = await (value as Promise<unknown>);
  }
  if (typeof value === "string") value = await document.getDestination(value);
  return Array.isArray(value) ? value : null;
}

/**
 * An internal link's destination as a page the viewer can scroll to.
 * A name that the document does not know, or a page that is not loaded, is
 * `null` — the click then changes nothing.
 */
export async function resolvePdfLinkDestination(
  document: PdfDestDocument,
  dest: unknown,
  pageAt: (pageNumber: number) => DestPage | null,
): Promise<PdfDestTarget | null> {
  const explicit = await explicitDestination(document, dest);
  if (!explicit) return null;
  const pageNumber = await pageNumberForRef(document, explicit[0]);
  if (pageNumber === null) return null;
  const page = pageAt(pageNumber);
  if (!page) return null;
  return { pageNumber, point: destinationScrollPoint(explicit, page) };
}
