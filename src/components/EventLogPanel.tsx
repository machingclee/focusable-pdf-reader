import { useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { apiErrorMessage } from "../store/api/baseApi";
import {
  useGetEventsQuery,
  type AuditEvent,
  type AuditEventQuery,
} from "../store/api/eventAuditApi";

const PAGE_SIZE = 20;

function prettyPayload(raw: string): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function EventLogPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [requestId, setRequestId] = useState("");
  const [eventType, setEventType] = useState("");
  const [success, setSuccess] = useState<boolean | undefined>(undefined);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const query = useMemo<AuditEventQuery>(
    () => ({
      page: page - 1,
      limit: PAGE_SIZE,
      requestId: requestId.trim() || undefined,
      eventType: eventType.trim() || undefined,
      success,
      sortOrder,
    }),
    [page, requestId, eventType, success, sortOrder],
  );

  const { data, isLoading, isFetching, refetch, error } = useGetEventsQuery(query, {
    skip: !open,
  });

  useEffect(() => {
    setPage(1);
  }, [requestId, eventType, success]);

  useEffect(() => {
    if (!open) {
      setExpanded(new Set());
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const errorMessage = error ? (apiErrorMessage(error) ?? "Could not load events.") : null;
  const hasFilters = requestId.trim() !== "" || eventType.trim() !== "" || success !== undefined;

  const toggle = (event: AuditEvent) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(event.id)) next.delete(event.id);
      else next.add(event.id);
      return next;
    });
  };

  const toggleSort = () => {
    setSortOrder((current) => {
      if (current === undefined) return "asc";
      if (current === "asc") return "desc";
      return undefined;
    });
  };

  return (
    <div className="event-log-overlay" role="dialog" aria-modal="true" aria-label="Event log" onMouseDown={onClose}>
      <section className="event-log-panel" onMouseDown={(event) => event.stopPropagation()}>
        <header className="event-log-head">
          <div>
            <h2>Event Log</h2>
            <p>Commands and events recorded by the application</p>
          </div>
          <div className="event-log-head-actions">
            <button type="button" onClick={() => void refetch()} disabled={isFetching} title="Refresh events">
              <RefreshCw size={14} className={isFetching ? "spinning" : undefined} />
              Refresh
            </button>
            <button type="button" onClick={onClose} aria-label="Close event log" title="Close">
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="event-log-filters">
          <div className="event-log-success">
            {([undefined, true, false] as const).map((value) => {
              const active = success === value;
              return (
                <button
                  key={String(value)}
                  type="button"
                  className={active ? "is-active" : undefined}
                  onClick={() => setSuccess(value)}
                >
                  {value === undefined ? "All" : value ? "Success" : "Failed"}
                </button>
              );
            })}
          </div>
          <label className="event-log-filter">
            <Search size={13} />
            <input
              value={requestId}
              onChange={(event) => setRequestId(event.target.value)}
              placeholder="Request ID"
              spellCheck={false}
            />
          </label>
          <label className="event-log-filter">
            <Search size={13} />
            <input
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              placeholder="Event type"
              spellCheck={false}
            />
          </label>
          {hasFilters && (
            <button
              type="button"
              className="event-log-clear"
              onClick={() => {
                setRequestId("");
                setEventType("");
                setSuccess(undefined);
              }}
            >
              <X size={13} /> Clear filters
            </button>
          )}
        </div>

        <div className="event-log-list">
          {isLoading ? (
            <p className="event-log-empty">Loading…</p>
          ) : errorMessage ? (
            <p className="event-log-empty is-error">{errorMessage}</p>
          ) : events.length === 0 ? (
            <p className="event-log-empty">No events recorded yet.</p>
          ) : (
            events.map((event) => {
              const isOpen = expanded.has(event.id);
              return (
                <article key={event.id} className={`event-row${isOpen ? " is-open" : ""}`}>
                  <button type="button" className="event-row-head" onClick={() => toggle(event)}>
                    <ChevronRight size={14} className="event-row-chevron" />
                    <code>{event.eventType}</code>
                    <span className={`event-row-status${event.success ? " is-success" : " is-failure"}`}>
                      {event.success ? "Success" : "Failed"}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="event-row-body">
                      <div className="event-row-meta">
                        <button type="button" onClick={toggleSort} title="Sort by event order">
                          #{event.eventOrder}
                          {sortOrder === "asc" ? " ↑" : sortOrder === "desc" ? " ↓" : ""}
                        </button>
                        <code>{event.requestId}</code>
                        <span>{formatTime(event.createdAt)}</span>
                        {event.requestUserEmail && <span>{event.requestUserEmail}</span>}
                      </div>
                      <div className="event-row-kind">{event.kind}</div>
                      <pre>{prettyPayload(event.payload)}</pre>
                      {!event.success && event.failureReason && (
                        <pre className="event-row-failure">{event.failureReason}</pre>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        <footer className="event-log-footer">
          <span>
            {total} event{total === 1 ? "" : "s"} · page {Math.min(page, totalPages)} / {totalPages}
          </span>
          <div>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || isFetching}>
              Previous
            </button>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages || isFetching}>
              Next
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
