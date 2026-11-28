/**
 * A PDF dropped on the window: the veil, the paths, and the way back.
 *
 * A drop arrives by two different routes and only one of them has a file path:
 *
 * - **the desktop** (Tauri) delivers real paths on the webview's drag-drop event,
 *   so the document is opened through the library like any other — which is what
 *   keeps the `original_path` the reader recognises it by;
 * - **a browser build** delivers a `File`, which has no path, so it is opened from
 *   its bytes and the notes column explains that its strips cannot be stored.
 *
 * The two must not both answer a desktop drop: the browser `File` would read the
 * original a second time. So the JS drag handlers bail out under Tauri, and the
 * webview listener is only registered there.
 *
 * The veil follows the drag rather than the pointer: it covers the whole window —
 * title strip, toolbar, page and notes — because a drop lands wherever it is
 * released. A drag that ends by the window losing focus does not always send a
 * `leave`, so a blur puts the veil away too.
 */
import { useEffect, useRef, type DragEvent } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { dragTypesIncludeFiles, isPdfFile, pdfPaths, showPdfDropVeil } from "./pdfDrop";
import { isTauri } from "./windowBridge";

export type PdfDropTargetOptions = {
  /** The veil is up: a PDF is being dragged over the window. */
  onVeil: (active: boolean) => void;
  /** Open the PDFs at these library paths, in order. */
  openPaths: (paths: string[]) => Promise<unknown> | void;
  /** A browser `File` was dropped: open its bytes. */
  openFiles: (files: File[]) => Promise<void>;
  /** Something was dropped that is not a PDF. */
  onRejected: () => void;
};

export type PdfDropTarget = {
  /** The root's own drag handlers, for the browser build. */
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
};

export function usePdfDropTarget({
  onVeil,
  openPaths,
  openFiles,
  onRejected,
}: PdfDropTargetOptions): PdfDropTarget {
  // Through refs: the desktop listener and the blur handler are registered once,
  // and the newest intentions must be the ones they run. (The callers pass fresh
  // arrows for these on every render.)
  const latest = useRef({ onVeil, openPaths, onRejected });
  latest.current = { onVeil, openPaths, onRejected };

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const { onVeil: veil, openPaths: open, onRejected: reject } = latest.current;
        if (event.payload.type === "enter") {
          veil(showPdfDropVeil(event.payload.paths));
          return;
        }
        if (event.payload.type === "leave") {
          veil(false);
          return;
        }
        if (event.payload.type !== "drop") return;
        veil(false);
        const paths = pdfPaths(event.payload.paths);
        if (paths.length > 0) {
          void open(paths);
          return;
        }
        if (event.payload.paths.length > 0) reject();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((cause) => {
        console.error(cause);
      });
    // A drag that ends by the window losing focus does not always send leave.
    const onBlur = () => latest.current.onVeil(false);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return {
    onDragEnter: (event) => {
      if (isTauri()) return;
      if (!dragTypesIncludeFiles(event.dataTransfer.types)) return;
      event.preventDefault();
      onVeil(true);
    },
    onDragOver: (event) => {
      if (isTauri()) return;
      if (!dragTypesIncludeFiles(event.dataTransfer.types)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event) => {
      if (isTauri()) return;
      // Crossing a control inside the window fires leave with the next element
      // still inside the root. Only a leave that has actually exited dismisses
      // the veil, or it would flicker on every button the pointer passes.
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      onVeil(false);
    },
    onDrop: async (event) => {
      event.preventDefault();
      onVeil(false);
      if (isTauri()) return;
      const files = Array.from(event.dataTransfer.files);
      const pdfs = files.filter(isPdfFile);
      if (pdfs.length > 0) {
        await openFiles(pdfs);
        return;
      }
      if (files.length > 0) onRejected();
    },
  };
}
