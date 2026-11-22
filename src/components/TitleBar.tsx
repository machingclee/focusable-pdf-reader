/**
 * Frameless window title strip, with the PDF / Notes switch at its right edge.
 *
 * The native macOS title bar is turned off in `src-tauri/tauri.conf.json`
 * (`titleBarStyle: "Overlay"` + `hiddenTitle: true`): the window keeps its
 * traffic lights, but they float over the content and no title chrome is drawn.
 * That is the same trick the shell-script-manager project uses.
 *
 * The catch is that the title bar was also the thing you dragged the window by,
 * so the whole strip takes that job over. `data-tauri-drag-region="deep"` is read
 * by Tauri's built-in handler, which starts a window drag on a press anywhere in
 * the element's subtree and toggles maximize on a double click (matching the
 * system double-click behaviour).
 *
 * The attribute sits on the strip rather than on the middle of it, so the
 * traffic-light gutter and the gaps around the view switch drag the window too —
 * that is what makes the *whole* bar behave like the title bar it replaces.
 *
 * The tabs keep working because the handler walks the press's composed path and
 * declines to drag when the path crosses a clickable element — `BUTTON`,
 * `INPUT`, `SELECT`, `TEXTAREA`, `LABEL` and the interactive ARIA roles — unless
 * that element carries the attribute itself. A press on a tab therefore switches
 * view; a press on the strip around it moves the window. (See
 * `tauri/src/window/scripts/drag.js`, 2.11. A bare
 * `data-tauri-drag-region="true"` would only fire for a press landing on the
 * element itself, which is why the value is `deep`.)
 *
 * Both drag behaviours are gated by capabilities rather than by this file:
 * `core:window:allow-start-dragging` and
 * `core:window:allow-internal-toggle-maximize` in
 * `src-tauri/capabilities/default.json`. Remove either and the window silently
 * stops moving.
 *
 * Nothing else lives up here. The strip is window chrome — a name and a view
 * switch — so the controls that *do* something to the page or to the backend sit
 * in the toolbar below it, on the same row as Open PDF and Find. That row is a
 * drag surface on the same terms (see `App`), so the two rows read as one piece
 * of window furniture instead of as a grabbable sliver above a wall of buttons.
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
}: {
  title: string;
  tab: AppTab;
  onTabChange: (tab: AppTab) => void;
}) {
  return (
    <div className="titlebar" data-tauri-drag-region="deep">
      <div className="titlebar-center">
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
    </div>
  );
}
