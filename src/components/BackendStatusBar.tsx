/**
 * Bottom-right status pill for the backend.
 *
 * It answers "is the backend up, and on which port?" and opens the backend's
 * Swagger UI (`/api-docs`) in the default browser when clicked. The address is
 * fixed in dev (`VITE_BACKEND_PORT`) and picked by the OS in a packaged build,
 * so showing it is also the quickest way to find the docs by hand.
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
 * The pill itself: a state dot, the address, and the docs link.
 *
 * `compact` drops the "Backend:" prefix and the "API docs" word. The pill lives in
 * two places — a footer row of its own, and the bottom of the pages rail — and the
 * rail is narrow: at its default width the full label would elide the address,
 * which is the one part of it that answers a question. The tooltip and the
 * accessible name keep the whole wording either way.
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

  /** The part that changes with the backend's state, without the subject. */
  const status =
    state === "connecting"
      ? "connecting…"
      : address
        ? state === "offline"
          ? `${address} (offline)`
          : address
        : "unavailable";
  const label = compact ? status : `Backend: ${status}`;

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
      aria-label={`Backend: ${status}. ${tooltip}`}
    >
      <span className="backend-status-dot" aria-hidden="true" />
      <span className="backend-status-label">{label}</span>
      {!compact && (
        <span className="backend-status-docs" aria-hidden="true">
          API docs
        </span>
      )}
    </button>
  );
}

/**
 * The pill in a footer row across the bottom — the detached notes window, which
 * has no rail to dock it into.
 */
export function BackendStatusBar() {
  return (
    <footer className="status-bar">
      <BackendStatusChip />
    </footer>
  );
}
