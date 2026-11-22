import { useEffect, useRef, useState } from "react";
import { flowEndpointPath, loadFlowFromFile, loadFlowFromText, loadFlowFromUrl } from "../flow/load";
import type { FlowGraph } from "../flow/types";

type Mode = "url" | "paste" | "file";

const DEFAULT_URL = flowEndpointPath();

interface LoadJsonDialogProps {
  open: boolean;
  onClose: () => void;
  onLoaded: (graph: FlowGraph, label: string) => void;
  /** Sent as X-Backend-Token on URL loads; set from the endpoint error panel. */
  token?: string;
}

/**
 * A side door, not the front door: the app already draws whatever its own
 * backend endpoint answers. This dialog inspects a captured response — another
 * environment's flow, a file a colleague sent, a pasted payload.
 *
 * Rendered with the reference's `.modal-overlay` / `.modal-content` /
 * `.btn-primary` classes.
 */
export default function LoadJsonDialog({ open, onClose, onLoaded, token }: LoadJsonDialogProps) {
  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState(DEFAULT_URL);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const run = async (task: () => Promise<{ graph: FlowGraph; label: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const { graph, label } = await task();
      onLoaded(graph, label);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (mode === "url") {
      void run(async () => ({ graph: await loadFlowFromUrl(url, token), label: url }));
      return;
    }
    if (mode === "paste") {
      void run(async () => ({ graph: loadFlowFromText(text), label: "pasted JSON" }));
      return;
    }
    fileInput.current?.click();
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    void run(async () => ({ graph: await loadFlowFromFile(file), label: file.name }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ minWidth: 520, maxWidth: 620 }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Load a flow JSON</h2>
        <p style={{ marginTop: -8, marginBottom: 16, fontSize: 13, lineHeight: 1.5, color: "#94a3b8" }}>
          The diagram normally reads <code>{DEFAULT_URL}</code> from the backend serving this page.
          Load something else to compare environments or inspect a captured response.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {(["url", "paste", "file"] as Mode[]).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={mode === candidate ? "btn-primary" : "btn-secondary"}
              onClick={() => {
                setMode(candidate);
                setError(null);
              }}
            >
              {candidate === "url" ? "From URL" : candidate === "paste" ? "Paste JSON" : "From file"}
            </button>
          ))}
        </div>

        {mode === "url" && (
          <label>
            Endpoint
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={DEFAULT_URL}
              spellCheck={false}
            />
          </label>
        )}

        {mode === "paste" && (
          <label>
            JSON
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={12}
              spellCheck={false}
              placeholder={'{ "commands": [ … ] }'}
            />
          </label>
        )}

        {mode === "file" && (
          <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
            Pick a <code>.json</code> file — the backend&apos;s <code>DomainFlow</code>, or the richer
            flow with payloads and a policies map.
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                pickFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        )}

        {error && (
          <p style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.55, color: "#fca5a5", whiteSpace: "pre-wrap" }}>
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={busy || (mode === "paste" && !text.trim())}
          >
            {busy ? "Loading…" : mode === "file" ? "Choose file…" : "Load"}
          </button>
        </div>
      </div>
    </div>
  );
}
