import { Workflow } from "lucide-react";

/**
 * Frameless window title strip, with the PDF / Notes switch at its right edge.
 *
 * The native macOS title bar is turned off in `src-tauri/tauri.conf.json`
 * (`titleBarStyle: "Overlay"` + `hiddenTitle: true`): the window keeps its
 * traffic lights, but they float over the content and no title chrome is drawn.
 * That is the same trick the shell-script-manager project uses.
 *
 * The catch is that the title bar was also the thing you dragged the window by.
 * The middle of this strip takes that job over — `data-tauri-drag-region="deep"`
 * is read by Tauri's built-in handler, which starts a window drag on a press,
 * and toggles maximize on a double click (matching the system double-click
 * behaviour).
 *
 * The tabs deliberately sit *outside* that drag region: Tauri starts a drag for
 * any press inside an element carrying the attribute, including a press on a
 * child button, so a tab nested in it would move the window instead of
 * switching view.
 *
 * Both drag behaviours are gated by capabilities rather than by this file:
 * `core:window:allow-start-dragging` and
 * `core:window:allow-internal-toggle-maximize` in
 * `src-tauri/capabilities/default.json`. Remove either and the window silently
 * stops moving.
 *
 * The `deep` value is deliberate: a bare `data-tauri-drag-region` only fires
 * when the press lands on the element itself, so pressing the document name —
 * a child element — would do nothing.
 */
export type AppTab = "pdf" | "notes";

const TABS: Array<{ id: AppTab; label: string }> = [
  { id: "pdf", label: "PDF" },
  { id: "notes", label: "Notes" },
];

export function TitleBar({
  title,
  tab,
  onTabChange,
  onOpenEvents,
  onOpenEventStorming,
  eventsOpen = false,
}: {
  title: string;
  tab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onOpenEvents: () => void;
  onOpenEventStorming: () => void;
  eventsOpen?: boolean;
}) {
  return (
    <div className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region="deep">
        <span className="titlebar-title">{title}</span>
      </div>
      <div className="titlebar-tabs" role="tablist" aria-label="View">
        {TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`titlebar-tab${active ? " is-active" : ""}`}
              onClick={() => onTabChange(entry.id)}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={`titlebar-events${eventsOpen ? " is-active" : ""}`}
        onClick={onOpenEvents}
        aria-pressed={eventsOpen}
        title="Event log"
      >
        Events
      </button>
      <button
        type="button"
        className="titlebar-events"
        onClick={onOpenEventStorming}
        title="Open the event-storming diagram"
      >
        <Workflow size={13} aria-hidden />
        Flow
      </button>
    </div>
  );
}
