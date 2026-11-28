/**
 * The Dashboard tab's chrome row: the window's second drag surface, and the home
 * of the controls that act on the backend rather than on a page — the flow
 * drawn, and the flow recorded.
 *
 * Both are tools for looking at the backend, so a packaged build does not show
 * them; a development build does. The row itself is drawn in every build either
 * way. It is the same strip the PDF view puts over its workspace, and the two
 * views swap one for the other, so a row that vanished with its buttons would
 * drop the panes by its height every time the tab changed. What stands in for
 * the hidden buttons is `toolbar-slot`, a pill's box with no width, so the row
 * keeps the height its controls gave it without holding on to them.
 *
 * The row is also where the next app-level control goes: it is already the
 * window's drag surface and already the right height.
 */
import { Workflow } from "lucide-react";
import { openEventStorming } from "./openEventStorming";

export type DashboardToolbarProps = {
  /** The backend's own tools — the flow diagram and the event log — belong to a development build. */
  showBackendTools: boolean;
  eventLogOpen: boolean;
  onToggleEventLog: () => void;
  /** The window's error line, when there is one. */
  error: string | null;
};

export function DashboardToolbar({
  showBackendTools,
  eventLogOpen,
  onToggleEventLog,
  error,
}: DashboardToolbarProps) {
  return (
    <header className="toolbar" data-tauri-drag-region="deep">
      <div className="toolbar-cluster">
        {showBackendTools ? (
          <>
            <button
              className="ghost ghost-with-icon"
              onClick={() => void openEventStorming()}
              title="Open the event-storming diagram"
            >
              <Workflow size={14} aria-hidden />
              Flow
            </button>
            <button
              className={`ghost${eventLogOpen ? " active" : ""}`}
              onClick={onToggleEventLog}
              aria-pressed={eventLogOpen}
              title="Event log — the backend's commands and events, beside the notes"
            >
              Events
            </button>
          </>
        ) : (
          /* A zero-width space, so the box is a pill's height: the line box is
             the row's own font, and the block padding and border below are a
             pill's. Nothing of it is painted or clicked; it holds the row up. */
          <span className="toolbar-slot" aria-hidden="true">{"\u200b"}</span>
        )}
        {error && <span className="status-error">{error}</span>}
      </div>
    </header>
  );
}
