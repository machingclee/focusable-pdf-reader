import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import Toolbar from "./components/Toolbar";
import FlowCanvas from "./components/FlowCanvas";
import Inspector from "./components/Inspector";
import LoadJsonDialog from "./components/LoadJsonDialog";
import { EndpointError, EndpointLoading } from "./components/EndpointStatus";
import {
  FlowEndpointError,
  flowEndpointPath,
  loadFlowFromFile,
  loadFlowFromUrl,
} from "./flow/load";
import {
  buildLayout,
  parseNodeId,
  type LayoutTab,
  type Selection,
} from "./flow/layout";
import { focusGraph } from "./flow/focus";
import type { FlowGraph } from "./flow/types";

const TOKEN_KEY = "backend-event-storming.token";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const EMPTY_GRAPH: FlowGraph = {
  source: "domain-flow",
  title: "",
  commands: [],
  events: [],
  queries: [],
  policies: [],
  contexts: [],
  dtos: {},
  queryDtos: {},
  externalContexts: [],
};

function storedToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "flow"
  );
}

function downloadJson(graph: FlowGraph): void {
  const payload = {
    title: graph.title,
    source: graph.source,
    commands: graph.commands,
    events: graph.events,
    policies: graph.policies,
    queries: graph.queries,
    dtos: graph.dtos,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${slugify(graph.title)}.flow.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function EventStormingApp() {
  const { fitView } = useReactFlow();

  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [sourceLabel, setSourceLabel] = useState(() => flowEndpointPath());
  const [token, setToken] = useState(storedToken);
  const [busy, setBusy] = useState(true);
  const [bootError, setBootError] = useState<Error | null>(null);
  const [tab, setTab] = useState<LayoutTab>(() =>
    new URLSearchParams(window.location.search).get("tab") === "queries" ? "queries" : "commands",
  );
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Selection | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("select");
    return raw ? parseNodeId(raw) : null;
  });
  const [showWildcard, setShowWildcard] = useState(true);
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  const [focusNonce, setFocusNonce] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const toggleSchema = useCallback((nodeIdValue: string) => {
    setExpandedSchemas((previous) => {
      const next = new Set(previous);
      if (next.has(nodeIdValue)) next.delete(nodeIdValue);
      else next.add(nodeIdValue);
      return next;
    });
  }, []);

  const applyGraph = useCallback((next: FlowGraph, label: string) => {
    setGraph(next);
    setSourceLabel(label);
    setBootError(null);
    setError(null);
    setSearch("");
    setSelection(null);
    setExpandedSchemas(new Set());
  }, []);

  const loadFromEndpoint = useCallback(
    async (options: { url?: string; token?: string } = {}) => {
      setBusy(true);
      setBootError(null);
      const url = options.url ?? flowEndpointPath();
      try {
        const next = await loadFlowFromUrl(options.url, options.token ?? token);
        applyGraph(next, url);
      } catch (caught) {
        setGraph(null);
        setBootError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setBusy(false);
      }
    },
    [applyGraph, token],
  );

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const override = new URLSearchParams(window.location.search).get("url");
    const resolved = override ? new URL(override, document.baseURI).toString() : undefined;
    void loadFromEndpoint({ url: resolved });
  }, [loadFromEndpoint]);

  const useToken = (value: string) => {
    setToken(value);
    try {
      window.localStorage.setItem(TOKEN_KEY, value);
    } catch {
      // Private windows reject storage; the token still works for this session.
    }
    void loadFromEndpoint({ token: value });
  };

  // Geometry only: no search or selection, so typing never moves a card the
  // user has dragged.
  const layout = useMemo(
    () =>
      buildLayout(graph ?? EMPTY_GRAPH, {
        tab,
        showWildcard,
        expandedSchemas,
        onToggleSchema: toggleSchema,
      }),
    [graph, tab, showWildcard, expandedSchemas, toggleSchema],
  );

  const focused = useMemo(
    () => focusGraph(layout.nodes, layout.edges, { search, selection }),
    [layout, search, selection],
  );

  const dropFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      applyGraph(await loadFlowFromFile(file), file.name);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flow-app${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void dropFile(event.dataTransfer.files?.[0]);
      }}
    >
      {graph ? (
        <>
          <FlowCanvas
            nodes={focused.nodes}
            edges={focused.edges}
            matches={focused.matches}
            contentWidth={layout.width}
            fitKey={`${sourceLabel}|${tab}|${graph.title}`}
            layoutKey={`${sourceLabel}|${tab}|${showWildcard}|${graph.title}|${[...expandedSchemas].sort().join(",")}`}
            focusNonce={focusNonce}
            onSelect={setSelection}
          />
          {selection && (
            <Inspector graph={graph} selection={selection} onClose={() => setSelection(null)} />
          )}
        </>
      ) : bootError ? (
        <EndpointError
          error={bootError}
          endpoint={flowEndpointPath()}
          busy={busy}
          needsToken={
            bootError instanceof FlowEndpointError &&
            (bootError.status === 401 || bootError.status === 403)
          }
          onRetry={() => void loadFromEndpoint()}
          onUseToken={useToken}
          onOpenLoad={() => setDialogOpen(true)}
        />
      ) : (
        <EndpointLoading endpoint={flowEndpointPath()} />
      )}

      <Toolbar
        graph={graph}
        loading={busy}
        stats={layout.stats}
        endpoint={flowEndpointPath()}
        tab={tab}
        onTabChange={(next) => {
          setTab(next);
          setSelection(null);
        }}
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={() => setFocusNonce((value) => value + 1)}
        matchCount={focused.matches.length}
        showWildcard={showWildcard}
        onToggleWildcard={() => setShowWildcard((value) => !value)}
        onFitAll={() => fitView({ padding: 0.15, duration: 400 })}
        onOpenLoad={() => setDialogOpen(true)}
        onReload={() => void loadFromEndpoint()}
        onExport={() => graph && downloadJson(graph)}
        sourceLabel={sourceLabel}
        inspectorOpen={Boolean(selection)}
      />

      {error && (
        <div className="flow-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} title="Dismiss">
            ✕
          </button>
        </div>
      )}

      <LoadJsonDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onLoaded={applyGraph}
        token={token}
      />

      {dragging && <div className="drop-hint">Drop the flow JSON to draw it</div>}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <EventStormingApp />
    </ReactFlowProvider>
  );
}
