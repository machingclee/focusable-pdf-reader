import { useEffect, useRef } from "react";
import type { FlowGraph } from "../flow/types";
import type { LayoutTab, LayoutResult } from "../flow/layout";

/**
 * The floating chrome of `echarge-event-storming-component`: a centred tab bar
 * and, top-right, the search box above a row of buttons — all rendered with the
 * classes that project's stylesheet defines (`.flow-toolbar`, `.flow-btn`,
 * `.flow-search-input`, …).
 *
 * The graph's own name and counts sit in a last row, because this app draws one
 * backend's domain rather than a loaded file.
 */

interface ToolbarProps {
  graph: FlowGraph | null;
  loading: boolean;
  stats: LayoutResult["stats"];
  endpoint: string;
  tab: LayoutTab;
  onTabChange: (tab: LayoutTab) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  matchCount: number;
  showWildcard: boolean;
  onToggleWildcard: () => void;
  onFitAll: () => void;
  onOpenLoad: () => void;
  onReload: () => void;
  onExport: () => void;
  sourceLabel: string;
  /** The inspector docks on the right, so the floating toolbar moves left. */
  inspectorOpen: boolean;
}

export default function Toolbar({
  graph,
  loading,
  stats,
  endpoint,
  tab,
  onTabChange,
  search,
  onSearchChange,
  onSearchSubmit,
  matchCount,
  showWildcard,
  onToggleWildcard,
  onFitAll,
  onOpenLoad,
  onReload,
  onExport,
  sourceLabel,
  inspectorOpen,
}: ToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search box, as in the reference.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const tabBtn = (value: LayoutTab) => {
    const active = tab === value;
    return {
      padding: "8px 22px",
      fontSize: "13px",
      fontWeight: 600 as const,
      letterSpacing: "0.01em",
      border: "none",
      borderRadius: "8px",
      cursor: "pointer",
      background: active ? "#1e40af" : "transparent",
      color: active ? "#ffffff" : "#475569",
      boxShadow: active ? "0 1px 3px rgba(30, 64, 175, 0.35)" : "none",
      transition: "background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease",
    };
  };

  const summary = graph
    ? [
        `${stats.commands} commands`,
        `${stats.events} events${stats.externalEvents > 0 ? ` (${stats.externalEvents} external)` : ""}`,
        `${stats.policies} policies`,
        `${stats.queries} queries`,
      ].join(" · ")
    : loading
      ? "reading the graph…"
      : "no graph yet";

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 12,
          // Centred over the canvas that is actually visible: the inspector takes
          // the right edge, so the tab bar steps left with the toolbar.
          left: inspectorOpen ? "calc((100% - 416px) / 2)" : "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          display: "flex",
          gap: 4,
          padding: 4,
          borderRadius: 12,
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
        }}
      >
        <button type="button" style={tabBtn("commands")} onClick={() => onTabChange("commands")}>
          Commands
        </button>
        <button type="button" style={tabBtn("queries")} onClick={() => onTabChange("queries")}>
          Queries
        </button>
      </div>

      <div className="flow-toolbar" style={{ right: inspectorOpen ? 416 : 16 }}>
        <div className="flow-search">
          <input
            ref={inputRef}
            className="flow-search-input"
            value={search}
            placeholder="Search names, payload fields…  ( / )"
            disabled={!graph}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSearchSubmit();
              if (event.key === "Escape") onSearchChange("");
            }}
          />
          {search.trim().length > 0 && (
            <div className="flow-search-filter">
              {matchCount === 0 ? "no match" : `${matchCount} match${matchCount === 1 ? "" : "es"}`}
              <span className="flow-search-filter-label">· ⏎ to step</span>
              <span className="flow-search-filter-clear" onClick={() => onSearchChange("")}>
                ✕
              </span>
            </div>
          )}
        </div>

        <div className="flow-toolbar-row">
          <button type="button" className="flow-btn flow-btn-ghost" onClick={onOpenLoad}>
            Load JSON
          </button>
          <button
            type="button"
            className="flow-btn flow-btn-ghost"
            onClick={onReload}
            disabled={loading}
            title={`Re-read ${endpoint}`}
          >
            {loading ? "Loading…" : "Reload"}
          </button>
          <button
            type="button"
            className="flow-btn flow-btn-ghost"
            onClick={onFitAll}
            disabled={!graph}
          >
            Fit
          </button>
          <button
            type="button"
            className="flow-btn flow-btn-ghost"
            onClick={onExport}
            disabled={!graph}
          >
            Export
          </button>
          <button
            type="button"
            className={`flow-btn flow-btn-edit${showWildcard ? " is-on" : ""}`}
            onClick={onToggleWildcard}
            title="Edges from every event to a policy that listens to DomainEvent"
          >
            <span className="flow-btn-edit-dot" aria-hidden />
            Wildcard: {showWildcard ? "ON" : "OFF"}
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            maxWidth: 470,
            padding: "6px 10px",
            borderRadius: 12,
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            boxShadow: "0 4px 16px rgba(15, 23, 42, 0.08)",
            fontSize: 11,
            color: "#475569",
          }}
        >
          <span style={{ fontWeight: 700, color: "#0f172a", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {graph ? graph.title : loading ? "Loading the domain graph…" : "Flow graph not loaded"}
          </span>
          <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {summary}
          </span>
          <span
            style={{ color: "#64748b", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={sourceLabel}
          >
            {sourceLabel}
          </span>
        </div>
      </div>
    </>
  );
}
