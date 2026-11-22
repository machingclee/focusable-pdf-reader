import { useState } from "react";

/**
 * What the canvas shows before the graph exists.
 *
 * Uses the reference's modal vocabulary — the dark `.modal-content` panel and
 * its `.btn-primary` / `.btn-secondary` buttons — because those are the only
 * surfaces that project styles for "a box floating over the canvas".
 */

interface EndpointErrorProps {
  error: Error;
  endpoint: string;
  busy: boolean;
  needsToken: boolean;
  onRetry: () => void;
  onUseToken: (token: string) => void;
  onOpenLoad: () => void;
}

export function EndpointError({
  error,
  endpoint,
  busy,
  needsToken,
  onRetry,
  onUseToken,
  onOpenLoad,
}: EndpointErrorProps) {
  const [token, setToken] = useState("");

  return (
    <div className="endpoint">
      <div className="modal-content endpoint__card">
        <span className="endpoint__eyebrow">GET {endpoint}</span>
        <h2>Could not load the flow graph</h2>
        <p className="endpoint__message">{error.message}</p>

        {needsToken && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (token.trim().length > 0) onUseToken(token.trim());
            }}
          >
            <label>
              X-Backend-Token
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="the value the backend was started with"
                spellCheck={false}
                autoFocus
              />
            </label>
            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button type="submit" className="btn-primary" disabled={busy || !token.trim()}>
                Use token
              </button>
            </div>
          </form>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onOpenLoad}>
            Load a JSON file
          </button>
          <button type="button" className="btn-primary" onClick={onRetry} disabled={busy}>
            {busy ? "Retrying…" : "Retry"}
          </button>
        </div>

        <p className="endpoint__hint">
          The diagram reads the graph from the backend it is served by. Start it with{" "}
          <code>bun run dev</code> in <code>backend/</code>, then reload. In development the Vite
          server proxies <code>{endpoint}</code> to <code>127.0.0.1:4317</code>.
        </p>
      </div>
    </div>
  );
}

export function EndpointLoading({ endpoint }: { endpoint: string }) {
  return (
    <div className="endpoint">
      <div className="modal-content endpoint__card endpoint__card--loading">
        <span className="endpoint__spinner" aria-hidden />
        <h2>Reading the domain graph…</h2>
        <p className="endpoint__message">
          Asking <code>{endpoint}</code> on this origin for the backend&apos;s commands, queries,
          events and policies.
        </p>
      </div>
    </div>
  );
}
