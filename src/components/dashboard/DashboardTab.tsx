/**
 * The Dashboard tab: the app's own two columns — the saved documents with their
 * notes, and the strips of the one that is open — behind a chrome row of their
 * own.
 *
 * That row is identical to the PDF view's: the window's second drag surface, and
 * the container for the controls that act on the backend rather than on a page —
 * the flow drawn, and the flow recorded. Both are app-level, which is why they
 * live here: the log is watched while the notes are browsed as well.
 *
 * Everything else is `DashboardView`'s own: this tab only owns the row above it,
 * so it passes the viewer's callbacks through untouched (`DashboardViewProps`
 * is the contract) rather than restating them.
 */
import { Workflow } from "lucide-react";
import { DashboardView, type DashboardViewProps } from "../DashboardView";
import { openEventStorming } from "./openEventStorming";
import { useAppSelector } from "../../store/hooks";
import { selectError } from "../../store/slices/documentSlice";

export type DashboardTabProps = {
  eventLogOpen: boolean;
  onToggleEventLog: () => void;
} & Pick<
  DashboardViewProps,
  | "onOpenDocument"
  | "onOpenDocumentInNewWindow"
  | "onOpenStrip"
  | "onRevealNote"
  | "onRevealAnnotation"
  | "onDocumentDeleted"
  | "onStatus"
  | "pendingEditId"
  | "onPendingEditHandled"
>;

export function DashboardTab({ eventLogOpen, onToggleEventLog, ...view }: DashboardTabProps) {
  // The window's error line, and the one diagram the tab opens, are the tab's own
  // business: nothing above it needs to know about either.
  const error = useAppSelector(selectError);
  return (
    <div className="dashboard">
      <header className="toolbar" data-tauri-drag-region="deep">
        <div className="toolbar-cluster">
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
            onClick={() => onToggleEventLog()}
            aria-pressed={eventLogOpen}
            title="Event log — the backend's commands and events, beside the notes"
          >
            Events
          </button>
          {error && <span className="status-error">{error}</span>}
        </div>
      </header>
      <DashboardView {...view} />
    </div>
  );
}
