/**
 * The Dashboard tab: the app's own two columns — the saved documents with their
 * notes, and the strips of the one that is open — behind a chrome row of their
 * own.
 *
 * The row is `DashboardToolbar`'s; this tab only says which build is running, so
 * the row's backend tools (the flow diagram and the event log) are shown in a
 * development build and left out of a packaged one. Everything else is
 * `DashboardView`'s own: the viewer's callbacks pass through untouched
 * (`DashboardViewProps` is the contract) rather than being restated here.
 */
import { DashboardView, type DashboardViewProps } from "../DashboardView";
import { DashboardToolbar } from "./DashboardToolbar";
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
  // The window's error line is the tab's own business: nothing above it needs to
  // know about it.
  const error = useAppSelector(selectError);
  return (
    <div className="dashboard">
      <DashboardToolbar
        showBackendTools={import.meta.env.DEV}
        eventLogOpen={eventLogOpen}
        onToggleEventLog={onToggleEventLog}
        error={error}
      />
      <DashboardView {...view} />
    </div>
  );
}
