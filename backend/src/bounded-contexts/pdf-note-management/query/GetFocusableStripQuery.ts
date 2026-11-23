import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Payload, Query } from "@machingclee/express-cqrs";
import type { FocusableStripWithDocument } from "../types.ts";

/**
 * One strip, by id.
 *
 * A note may point at another note — a `[note:12]` reference pasted into a
 * remark — and that pointer has to survive the list it was copied from: the
 * reader can be in another document, in the note popup, or in a card whose
 * strip is already on screen. So the id is resolved on its own rather than by
 * filtering a list, and the answer carries the document because the nested card
 * names it and paints the strip's band from its file.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ id: "number" })
export class GetFocusableStripQuery extends Query<FocusableStripWithDocument> {
  constructor(readonly id: number) {
    super();
  }
}
