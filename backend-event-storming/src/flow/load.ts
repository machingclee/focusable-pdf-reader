import { FlowJsonError, normalizeFlow, parseFlowJson } from "./normalize";
import type { FlowGraph } from "./types";

/**
 * Where the graph comes from.
 *
 * The primary source is the backend the page is served by: the production build
 * lives at `http://<backend>/event-storming/` and calls `GET /docs/commands` on
 * that same origin, so there is no CORS negotiation and no stale copy of the
 * JSON in this repository. In development Vite proxies `/docs/*` to the backend,
 * so the same relative path works.
 *
 * File, paste and explicit-URL loading remain available for inspecting a
 * snapshot someone sent you, but they are never what the app boots from.
 */

/** The path the app asks for, resolved against the page's own base URL. */
export function flowEndpointPath(): string {
  return new URL("../docs/commands", document.baseURI).pathname;
}

/** Absolute same-origin URL of the flow endpoint. */
export function flowEndpointUrl(): string {
  return new URL("../docs/commands", document.baseURI).toString();
}

/** An endpoint that answered with a non-2xx status (401 needs a token). */
export class FlowEndpointError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = "FlowEndpointError";
    this.status = status;
    this.url = url;
  }
}

/** Fetch and normalize the graph from a URL (defaults to the backend endpoint). */
export async function loadFlowFromUrl(
  url: string = flowEndpointUrl(),
  token?: string,
): Promise<FlowGraph> {
  const trimmed = token?.trim();
  const headers = trimmed ? { "X-Backend-Token": trimmed } : undefined;

  let response: Response;
  try {
    response = await fetch(url, { headers, cache: "no-store" });
  } catch (error) {
    throw new FlowEndpointError(
      `Could not reach ${url}. Is the backend running? ` +
        `(${error instanceof Error ? error.message : String(error)})`,
      0,
      url,
    );
  }

  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? " The backend runs with BACKEND_TOKEN, so this page needs the token."
        : response.status === 404
          ? " Check that the backend is running this build and that the path is /docs/commands."
          : "";
    throw new FlowEndpointError(
      `${url} answered ${response.status} ${response.statusText}.${hint}`,
      response.status,
      url,
    );
  }

  const text = await response.text();
  const parsed = JSON.parse(text) as {
    success?: unknown;
    data?: unknown;
    errorMessage?: unknown;
  };
  if (parsed && typeof parsed === "object" && parsed.success === false) {
    throw new FlowEndpointError(
      typeof parsed.errorMessage === "string" ? parsed.errorMessage : `${url} returned an error.`,
      response.status,
      url,
    );
  }
  return parseFlowJson(
    parsed && typeof parsed === "object" && parsed.success === true
      ? JSON.stringify(parsed.data)
      : text,
  );
}

export function loadFlowFromText(text: string): FlowGraph {
  if (text.trim().length === 0) throw new FlowJsonError("Nothing to load — the JSON is empty.");
  return parseFlowJson(text);
}

export function loadFlowFromFile(file: File): Promise<FlowGraph> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new FlowJsonError(`Could not read ${file.name}.`));
    reader.onload = () => {
      try {
        resolve(parseFlowJson(String(reader.result ?? "")));
      } catch (error) {
        reject(
          error instanceof FlowJsonError
            ? new FlowJsonError(`${file.name}: ${error.message}`)
            : error,
        );
      }
    };
    reader.readAsText(file);
  });
}

export function loadFlowFromUnknown(value: unknown): FlowGraph {
  return normalizeFlow(value);
}
