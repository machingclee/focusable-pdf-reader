import { useCallback, useEffect, useRef } from "react";
import { historyShortcut, isEditableShortcutTarget } from "./historyShortcut";
import { historyApi } from "./store/api/historyApi";

let locked = false;

/**
 * Cmd+Z undoes the latest library change. Cmd+Y and Cmd+Shift+Z redo it.
 *
 * A press that starts in a text field or the markdown editor is left alone.
 * The menu and the key share one lock, so both firing for the same chord apply
 * the step once.
 */
export function useHistoryShortcuts(): { undo: () => void; redo: () => void } {
  const [undoMutation] = historyApi.endpoints.undo.useMutation();
  const [redoMutation] = historyApi.endpoints.redo.useMutation();
  const undoRef = useRef(undoMutation);
  const redoRef = useRef(redoMutation);
  undoRef.current = undoMutation;
  redoRef.current = redoMutation;

  const run = useCallback((direction: "undo" | "redo") => {
    if (locked) return;
    locked = true;
    const send = direction === "undo" ? undoRef.current() : redoRef.current();
    void send
      .unwrap()
      .catch((cause: unknown) => {
        const status = cause && typeof cause === "object" && "status" in cause ? cause.status : undefined;
        if (status === 409) return;
        console.error(cause);
      })
      .finally(() => {
        locked = false;
      });
  }, []);

  const undo = useCallback(() => run("undo"), [run]);
  const redo = useCallback(() => run("redo"), [run]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = historyShortcut(event);
      if (!shortcut) return;
      if (isEditableShortcutTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (shortcut === "undo") undo();
      else redo();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [redo, undo]);

  return { undo, redo };
}
