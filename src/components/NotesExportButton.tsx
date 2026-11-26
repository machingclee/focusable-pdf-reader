/**
 * "Export HTML": the notes of one document, opened where they can be read.
 *
 * It sits in the tools row both notes surfaces share, so the docked column and
 * the Dashboard tab offer the same thing in the same place — and the reader gets one
 * document per file, the one whose strips are on screen.
 *
 * The export engine is imported on click, never up front: it carries the whole
 * markdown pipeline and a syntax highlighter, which the viewer's own bundle has
 * no business paying for on launch. Same reason `MarkdownNote` is lazy.
 *
 * There is no folder to pick. The shell writes the file to a temporary path and
 * opens it in the browser, so the button's promise is "show me these notes on
 * their own", and the browser's own Save is there if the reader wants to keep
 * them. The page opens as the notes column does — folders folded, one click
 * from the cards — so a long document is an index before it is a scroll.
 *
 * The label is the progress: painting a picture per strip is the slow part, and
 * a disabled button that says "Exporting 3/12…" explains the wait better than a
 * spinner does.
 */
import { useCallback, useState } from "react";
import { FileDown } from "lucide-react";
import type { Note, NoteFolderWithNotes } from "../types/dto";

export type NotesExportButtonProps = {
  /** The document's name, as it will appear in the file's title. */
  documentName: string;
  /** Its path, for the strip pictures and the export's provenance line. */
  filePath: string;
  folders: NoteFolderWithNotes[];
  /** Strips in no folder: part of the export too. */
  unfiled: Note[];
  /** Page-level status line: what happened, or why it did not. */
  onStatus?: (message: string) => void;
};

type ExportState = { status: "idle" } | { status: "working"; done: number; total: number };

/** Tauri rejects with strings; a plain error with anything else. */
function failureMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "Unknown error.";
}

export function NotesExportButton({
  documentName,
  filePath,
  folders,
  unfiled,
  onStatus,
}: NotesExportButtonProps) {
  const [state, setState] = useState<ExportState>({ status: "idle" });
  // Folded cards are not part of the file, so they are not part of the wait either.
  const exportable = (notes: Note[]) => notes.filter((note) => note.expanded !== false).length;
  const strips = folders.reduce((total, folder) => total + exportable(folder.notes), 0) + exportable(unfiled);
  const working = state.status === "working";

  const exportNotes = useCallback(async () => {
    if (working) return;
    setState({ status: "working", done: 0, total: strips });
    try {
      const { exportDocumentNotes } = await import("../notesExport");
      const result = await exportDocumentNotes(
        { documentName, filePath, folders, unfiled },
        {
          onProgress: ({ done, total }) => setState({ status: "working", done, total }),
        },
      );
      onStatus?.(
        `Exported ${result.strips} strip${result.strips === 1 ? "" : "s"} and opened them in your browser.`,
      );
    } catch (cause) {
      onStatus?.(`Could not export the notes: ${failureMessage(cause)}`);
    } finally {
      setState({ status: "idle" });
    }
  }, [documentName, filePath, folders, strips, unfiled, onStatus, working]);

  return (
    <button
      type="button"
      className="notes-tool-button"
      onClick={() => void exportNotes()}
      disabled={working || strips === 0}
      title="Open everything in this list — folders, strips, pictures and notes — as one HTML page in your browser, with the folders folded ready to open"
    >
      <FileDown size={12} aria-hidden />
      {working ? `Exporting ${state.done}/${state.total}…` : "Export HTML"}
    </button>
  );
}
