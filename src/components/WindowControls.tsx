/**
 * The window buttons, for the platform that does not draw them for us.
 *
 * macOS gets its traffic lights from the system — `titleBarStyle: "Overlay"` in
 * `tauri.conf.json` leaves them floating over the content — so this renders
 * nothing there. On Windows the window is created undecorated
 * (`tauri.windows.conf.json`, and `src-tauri/src/win32.rs` for the frame that is
 * left), which leaves minimise / maximise / close with nowhere to live, so the
 * title strip draws them: at the far right, where Windows has always put them, in
 * the strip's own colours instead of the system grey. Close sits in the window's
 * corner, so its hover fill is clipped by the corner Windows rounds — the same
 * corner, and the same red, a native window would have there. The strip's top
 * few pixels stay Windows' own resize border, exactly as they do on a native
 * window; the buttons are 34px tall, so nothing about them depends on those
 * pixels.
 *
 * Each one is a real `<button>`. Tauri's drag handler walks the press's composed
 * path and declines to start a window drag over a clickable element, so pressing
 * a control does not also move the window — the same rule that lets the PDF /
 * Notes switch live inside the strip's drag region (see `TitleBar`).
 *
 * The commands behind them are gated by capabilities, not by this file:
 * `core:window:allow-minimize`, `core:window:allow-toggle-maximize` and
 * `core:window:allow-is-maximized` in `src-tauri/capabilities/default.json`.
 * Remove one and that control goes dead, silently.
 */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_WINDOWS } from "../platform";
import { isTauri } from "../windowBridge";

/** One drawn glyph each, at the 10px Windows uses for them. */
function MinimizeGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 5h8" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

function MaximizeGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

/** The maximised state's icon: two frames, the front one outlined. */
function RestoreGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3 2.5h4.5V7" stroke="currentColor" strokeWidth="1" fill="none" />
      <rect x="1.5" y="3.5" width="5" height="5" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
}

export function WindowControls() {
  /**
   * Which icon the middle button shows. The window can also be maximised by
   * double-clicking the strip or by Windows' own snapping, so the state is read
   * back from the window instead of being toggled from the click.
   */
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!IS_WINDOWS || !isTauri()) return;
    const win = getCurrentWindow();
    let cancelled = false;
    const sync = () => {
      win.isMaximized()
        .then((value) => {
          if (!cancelled) setMaximized(value);
        })
        .catch((cause) => console.error(cause));
    };
    sync();
    const unlisten = win.onResized(sync);
    return () => {
      cancelled = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  if (!IS_WINDOWS || !isTauri()) return null;
  const win = getCurrentWindow();

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => {
          void win.minimize().catch((cause) => console.error(cause));
        }}
      >
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => {
          void win.toggleMaximize().catch((cause) => console.error(cause));
        }}
      >
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        type="button"
        className="window-control is-close"
        aria-label="Close"
        title="Close"
        onClick={() => {
          void win.close().catch((cause) => console.error(cause));
        }}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
