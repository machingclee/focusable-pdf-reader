/**
 * Opening a document: the picker, and the list of documents already read.
 *
 * The two belong together because they answer the same question — which PDF —
 * one by asking the filesystem and one by asking history. No "Recents" caption:
 * the control already reads "Open recent…", and the row has better uses for the
 * width.
 *
 * The list is the document slice's, and opening is a viewer command: the toolbar
 * does not need to know who holds either.
 */
import { useAppSelector } from "../../store/hooks";
import { selectRecents } from "../../store/slices/documentSlice";
import { useViewerCommands } from "../app/viewerCommands";

export function OpenDocumentControls() {
  const recents = useAppSelector(selectRecents);
  const { openPicker, openRecent } = useViewerCommands();

  return (
    <div className="toolbar-cluster">
      <button className="primary" onClick={() => openPicker()}>
        Open PDF
      </button>
      <label className="recents-picker">
        <select
          value=""
          disabled={recents.length === 0}
          onChange={(event) => {
            const path = event.target.value;
            event.target.value = "";
            if (!path) return;
            openRecent(path);
          }}
        >
          <option value="">
            {recents.length ? "Open recent…" : "No recents"}
          </option>
          {recents.map((doc) => (
            <option
              key={doc.path ?? doc.name}
              value={doc.path ?? ""}
              disabled={!doc.path}
            >
              {doc.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
