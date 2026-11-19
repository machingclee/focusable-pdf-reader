/**
 * Typed client for the Bun backend (see `backend/README.md` for the endpoints).
 *
 * Address resolution lives in `backendConfig.ts`: a fixed port in dev, the
 * Rust-provided port in a packaged build.
 */
import { getBackendTarget, type BackendTarget } from "./backendConfig";

/** A backend response that was not 2xx. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type PdfDocument = {
  id: number;
  name: string;
  filePath: string;
  /** pdf.js fingerprint, used to re-link a moved file. */
  fingerprint: string | null;
  pageCount: number | null;
  /** Unix epoch milliseconds. */
  createdAt: number;
};

export type FocusableStrip = {
  id: number;
  pdfDocumentId: number;
  /** 1-based, same as `data-page` in the viewer. */
  pageNumber: number;
  /** Page-local position in PDF points, so zoom does not matter. */
  top: number;
  height: number;
  left: number;
  width: number;
  pageWidth: number;
  pageHeight: number;
  /** First ~200 characters: list label and backup locator. */
  textExcerpt: string | null;
  /** Markdown. */
  remark: string;
  /** Unix epoch milliseconds. */
  createdAt: number;
  /** Only present on `/focusable-strips` responses. */
  pdfDocument?: { id: number; name: string; filePath: string };
};

export type PdfDocumentWithStrips = PdfDocument & { focusableStrips: FocusableStrip[] };

export type PdfDocumentListItem = PdfDocument & { _count?: { focusableStrips: number } };

export type HealthResponse = {
  status: string;
  pid: number;
  uptimeSeconds: number;
};

export type ResolveDocumentInput = {
  filePath: string;
  /** Defaults to the file name without its extension, on first resolve. */
  name?: string;
  fingerprint?: string;
  pageCount?: number;
  /**
   * Write `name` over an existing document's name. Leave false so a name the
   * user edited is not reset to the file name every time the file is opened.
   */
  updateName?: boolean;
};

export type NewStripInput = {
  pdfDocumentId: number;
  pageNumber: number;
  top: number;
  height: number;
  left: number;
  width: number;
  pageWidth: number;
  pageHeight: number;
  textExcerpt?: string;
  remark?: string;
};

export type StripFilter = {
  pdfDocumentId?: number;
  pageNumber?: number;
};

export type TargetResolver = () => Promise<BackendTarget>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createApiClient(resolveTarget: TargetResolver) {
  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const target = await resolveTarget();
    const method = init.method ?? "GET";
    const headers = new Headers();
    let body: string | undefined;
    if (init.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(init.body);
    }
    if (target.token) headers.set("X-Backend-Token", target.token);

    const response = await fetch(`${target.baseUrl}${path}`, { method, headers, body, signal: init.signal });

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload = text.length > 0 ? parseJsonOrText(text) : null;

    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `${method} ${path} failed with ${response.status}`;
      throw new ApiError(response.status, message, payload);
    }

    return payload as T;
  }

  return {
    request,

    health: () => request<HealthResponse>("/health"),

    listDocuments: () => request<PdfDocumentListItem[]>("/pdf-documents"),

    /** Called every time a file is opened; creates the row or refreshes it. */
    resolveDocument: (input: ResolveDocumentInput) =>
      request<PdfDocumentWithStrips>("/pdf-documents/resolve", { method: "POST", body: input }),

    renameDocument: (id: number, name: string) =>
      request<PdfDocument>(`/pdf-documents/${id}`, { method: "PATCH", body: { name } }),

    listStrips: (filter: StripFilter = {}) => {
      const query = new URLSearchParams();
      if (filter.pdfDocumentId !== undefined) query.set("pdfDocumentId", String(filter.pdfDocumentId));
      if (filter.pageNumber !== undefined) query.set("pageNumber", String(filter.pageNumber));
      const queryString = query.toString();
      return request<FocusableStrip[]>(`/focusable-strips${queryString ? `?${queryString}` : ""}`);
    },

    createStrip: (input: NewStripInput) =>
      request<FocusableStrip>("/focusable-strips", { method: "POST", body: input }),

    updateStripRemark: (id: number, remark: string) =>
      request<FocusableStrip>(`/focusable-strips/${id}`, { method: "PATCH", body: { remark } }),

    deleteStrip: (id: number) => request<void>(`/focusable-strips/${id}`, { method: "DELETE" }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** The app-wide client; it resolves its address lazily on first use. */
export const api = createApiClient(getBackendTarget);
