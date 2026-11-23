import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { StripSnapshot } from "../history/rows.ts";
import type { Folder, PdfDocument } from "../types.ts";

/** The document order a step has to put back, id then position. */
export type DocumentOrder = { id: number; ordering: number };

/** The three columns a legacy import rewrites, as they were or as they became. */
export type DocumentLocation = {
  id: number;
  file_path: string;
  content_hash: string | null;
  original_path: string | null;
};

/** Put a strip back in the folder and position it had. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ id: "number", folderId: "number | null", ordering: "number" })
export class PlaceFocusableStripCommand extends Command<void> {
  constructor(
    readonly id: number,
    readonly folderId: number | null,
    readonly ordering: number,
  ) {
    super();
  }
}

/** Undo of saving a strip: remove it, and the folder that save opened. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ stripId: "number", createdFolderId: "number | null" })
export class RemoveCreatedStripCommand extends Command<void> {
  constructor(
    readonly stripId: number,
    readonly createdFolderId: number | null,
  ) {
    super();
  }
}

/** Redo of saving a strip, inserting the same ids the first save used. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ folder: "object | null", strip: "object" })
export class RestoreCreatedStripCommand extends Command<void> {
  constructor(
    readonly folder: Folder | null,
    readonly strip: StripSnapshot,
  ) {
    super();
  }
}

/** Put a folder, and the strips it held, back under their original ids. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ folder: "object", strips: "object[]" })
export class RestoreFolderCommand extends Command<void> {
  constructor(
    readonly folder: Folder,
    readonly strips: StripSnapshot[],
  ) {
    super();
  }
}

/** Put one strip back under its original id. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ strip: "object" })
export class RestoreFocusableStripCommand extends Command<void> {
  constructor(readonly strip: StripSnapshot) {
    super();
  }
}

/**
 * Put a document, its folders and its strips back, and move its library copy
 * out of the trash when the delete had parked it there.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ document: "object", folders: "object[]", strips: "object[]", highlights: "string" })
export class RestorePdfDocumentCommand extends Command<void> {
  constructor(
    readonly document: PdfDocument,
    readonly folders: Folder[],
    readonly strips: StripSnapshot[],
    /** JSON list of `{ page, x0, x1, y, size }` the document owned. */
    readonly highlights: string,
  ) {
    super();
  }
}

/** Undo of an import: drop the rows it created and park their copies in the trash. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({
  createdIds: "number[]",
  upgrades: "object[]",
  previousOrder: "object[]",
  createdFiles: "string[]",
})
export class RevertImportCommand extends Command<void> {
  constructor(
    readonly createdIds: number[],
    readonly upgrades: DocumentLocation[],
    readonly previousOrder: DocumentOrder[],
    readonly createdFiles: string[],
  ) {
    super();
  }
}

/** Redo of an import: the same rows, the same ids, and the copies back from the trash. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({
  created: "object[]",
  upgrades: "object[]",
  order: "object[]",
  createdFiles: "string[]",
})
export class RestoreImportCommand extends Command<void> {
  constructor(
    readonly created: PdfDocument[],
    readonly upgrades: DocumentLocation[],
    readonly order: DocumentOrder[],
    readonly createdFiles: string[],
  ) {
    super();
  }
}
