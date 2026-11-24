/**
 * The backend's status line: a hairline, a dot, and the address.
 *
 * It answers "is the backend up, and on which port?" and opens the backend's
 * Swagger UI (`/api-docs`) in the default browser when clicked. The address is
 * fixed in dev (`VITE_BACKEND_PORT`) and picked by the OS in a packaged build,
 * so showing it is also the quickest way to find the docs by hand.
 *
 * It sits at the foot of a column rather than in a bar of its own — the pages
 * rail in the viewer, a footer in the detached notes window — so it is written
 * as a status line one reads, not as a control one is drawn to.
 */

import { useCallback, useEffect, useState } from "react";
import { getBackendTarget, type BackendTarget } from "../backendConfig";
import { apiDocsUrl, backendAddressLabel } from "../backendStatus";

/** How often `/health` is asked again. */
const HEALTH_POLL_MS = 5_000;

type BackendState = "connecting" | "online" | "offline";

/** Poll the resolved address; retry resolving while Rust has not answered yet. */
function useBackendStatus(): {
  target: BackendTarget | null;
  state: BackendState;
  resolveError: string | null;
} {
  const [target, setTarget] = useState<BackendTarget | null>(null);
  const [state, setState] = useState<BackendState>("connecting");
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const poll = async (resolved: BackendTarget) => {
      try {
        const headers = new Headers();
        if (resolved.token) headers.set("X-Backend-Token", resolved.token);
        const response = await fetch(`${resolved.baseUrl}/health`, {
          headers,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`health check answered ${response.status}`);
        if (!disposed) setState("online");
      } catch {
        if (!disposed) setState("offline");
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(resolved), HEALTH_POLL_MS);
      }
    };

    const connect = async () => {
      try {
        const resolved = await getBackendTarget();
        if (disposed) return;
        setTarget(resolved);
        setResolveError(null);
        await poll(resolved);
      } catch (cause) {
        if (disposed) return;
        setState("offline");
        // Keep the reason: a missing Tauri permission or a dead sidecar both
        // end up here, and "unavailable" alone is not something a user can act
        // on. It goes in the pill's tooltip.
        setResolveError(cause instanceof Error ? cause.message : String(cause));
        // `getBackendTarget` does not cache failures, so asking again is enough
        // to pick the backend up once it has started (or restarted).
        timer = setTimeout(() => void connect(), HEALTH_POLL_MS);
      }
    };

    void connect();

    return () => {
      disposed = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  return { target, state, resolveError };
}

/** Hand the URL to the OS browser; a plain `window.open` outside Tauri. */
async function openExternally(url: string): Promise<void> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * The status line itself: a state dot, the address, and the docs link.
 *
 * It is one quiet sentence at the foot of whatever column it ends, not a pill.
 * `compact` is what the narrow pages rail asks for: the rail has one line and
 * no width to spare, so it drops the "API docs" word and the state word the
 * detached window's own footer has room to spell out — the dot says "up" or
 * "not answering", and the address answers "which port?", which is the whole
 * point of showing it. The tooltip and the accessible name keep the long
 * wording in both places.
 */
export function BackendStatusChip({ compact = false }: { compact?: boolean }) {
  const { target, state, resolveError } = useBackendStatus();
  const address = target ? backendAddressLabel(target.baseUrl) : null;

  const openDocs = useCallback(async () => {
    try {
      const resolved = target ?? (await getBackendTarget());
      await openExternally(apiDocsUrl(resolved.baseUrl));
    } catch (error) {
      console.error("[backend] could not open the API docs:", error);
    }
  }, [target]);

  /**
   * What the line says about the backend. Without an address there is nothing
   * to name but the state; with one, the address *is* the line, and only the
   * wide footer bar has room to add "offline" beside it.
   */
  const plain = state === "connecting" ? "connecting…" : (address ?? "unavailable");
  const withState = address && state === "offline" ? `${address} (offline)` : plain;
  const status = compact ? plain : withState;

  const tooltip =
    target !== null
      ? state === "offline"
        ? `The backend is not answering at ${target.baseUrl}. Click to open its API docs anyway.`
        : `Open the Swagger API docs at ${apiDocsUrl(target.baseUrl)}`
      : resolveError
        ? `The backend address is unknown: ${resolveError}`
        : "Waiting for the backend to report its address.";

  return (
    <button
      type="button"
      className={`backend-status ${state}`}
      onClick={() => void openDocs()}
      title={tooltip}
      // The full wording, whatever the visible label had to drop.
      aria-label={`Backend: ${withState}. ${tooltip}`}
    >
      <span className="backend-status-dot" aria-hidden="true" />
      <span className="backend-status-label">
        {/* The subject of the sentence. Narrow, the rail drops it rather than
            clipping the address (see the `@container` rule in App.css). */}
        <span className="backend-status-prefix">Backend: </span>
        {status}
      </span>
      {!compact && (
        <span className="backend-status-docs" aria-hidden="true">
          API docs
        </span>
      )}
    </button>
  );
}

/**
 * The line in a footer row across the bottom — the detached notes window, which
 * has no rail to dock it into.
 */
export function BackendStatusBar() {
  return (
    <footer className="status-bar">
      <BackendStatusChip />
    </footer>
  );
}
