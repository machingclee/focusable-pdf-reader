/**
 * Window-level keyboard shortcuts for markdown surfaces.
 *
 * Ported unchanged from the shell-script-manager project. Every handler is
 * optional; only the ones passed in are wired. `enabled: false` suspends the
 * listeners, which is how the dialog stays silent while it is closed.
 *
 * The dialog mounts these at the window level (rather than on a wrapper
 * element) because Monaco and the preview search input both stop propagation
 * on some keys — a bubbling-delegate on the dialog would never see them.
 */
import { useEffect } from "react";

export type MarkdownShortcutOptions = {
  /** Whether to install the listeners. Defaults to true. */
  enabled?: boolean;
  /** Cmd/Ctrl + S */
  onSave?: () => void | Promise<void>;
  /** Cmd/Ctrl + W */
  onClose?: () => void;
  /** Cmd/Ctrl + F */
  onFind?: () => void;
  /** Cmd/Ctrl + Enter */
  onSubmit?: () => void;
  /** Escape (bare, no modifier) */
  onEscape?: () => void;
  /** Cmd/Ctrl + = or + */
  onZoomIn?: () => void;
  /** Cmd/Ctrl + - */
  onZoomOut?: () => void;
  /** Cmd/Ctrl + 0 */
  onZoomReset?: () => void;
  /** Cmd/Ctrl + B — toggle between mixed and preview mode */
  onToggleView?: () => void;
  /** Cmd/Ctrl + Opt/Alt + B — toggle the preview pane (plain <-> mixed) */
  onTogglePreviewPanel?: () => void;
};

export function useMarkdownShortcuts({
  enabled = true,
  onSave,
  onClose,
  onFind,
  onSubmit,
  onEscape,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onToggleView,
  onTogglePreviewPanel,
}: MarkdownShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        onEscape
      ) {
        event.preventDefault();
        onEscape();
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;

      // Option remaps `event.key` (Cmd+Opt+B reports "∫" on a US layout), so
      // match the physical key. Checked before Cmd+B so the two stay distinct.
      if (
        event.altKey &&
        !event.shiftKey &&
        !event.repeat &&
        event.code === "KeyB" &&
        onTogglePreviewPanel
      ) {
        event.preventDefault();
        onTogglePreviewPanel();
        return;
      }

      if (event.key === "s" && onSave) {
        event.preventDefault();
        void onSave();
        return;
      }

      if (event.key === "w" && onClose) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "f" && onFind) {
        event.preventDefault();
        onFind();
        return;
      }

      if (event.key === "Enter" && onSubmit) {
        event.preventDefault();
        onSubmit();
        return;
      }

      if ((event.key === "=" || event.key === "+") && onZoomIn) {
        event.preventDefault();
        onZoomIn();
        return;
      }

      if (event.key === "-" && onZoomOut) {
        event.preventDefault();
        onZoomOut();
        return;
      }

      if (event.key === "0" && onZoomReset) {
        event.preventDefault();
        onZoomReset();
        return;
      }

      if (event.key === "b" && !event.altKey && onToggleView) {
        event.preventDefault();
        onToggleView();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    onSave,
    onClose,
    onFind,
    onSubmit,
    onEscape,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onToggleView,
    onTogglePreviewPanel,
  ]);
}
