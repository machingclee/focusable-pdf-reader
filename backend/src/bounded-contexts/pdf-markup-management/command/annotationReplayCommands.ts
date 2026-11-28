import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_MARKUP_MANAGEMENT } from "../../constants.ts";
import type { AnnotationSnapshot } from "../types.ts";

/**
 * The history steps the annotation commands answer with.
 *
 * They are here rather than beside the commands the reader sends because nothing
 * in the UI calls them: they exist so `⌘Z` and `⌘⇧Z` can be one step each. The
 * two that matter for a reference are `RestoreAnnotationCommand` and
 * `RemoveCreatedAnnotationCommand` — a create undone and a delete put back both
 * have to leave the row under a known id, or every `[annotation:<id>]` already
 * pasted into a note would point at nothing.
 */

/** Put one annotation back exactly as it was, id and `created_at` included. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_MARKUP_MANAGEMENT)
@Payload({ annotation: "object" })
export class RestoreAnnotationCommand extends Command<void> {
  constructor(readonly annotation: AnnotationSnapshot) {
    super();
  }
}

/** Undo of pinning one: remove the row the create just wrote. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_MARKUP_MANAGEMENT)
@Payload({ id: "number" })
export class RemoveCreatedAnnotationCommand extends Command<void> {
  constructor(readonly id: number) {
    super();
  }
}

/** The values an edit may put back: what it said, and where it stood. */
export type AnnotationValues = {
  page_number: number;
  x: number;
  y: number;
  width: number;
  text: string;
};

/**
 * Either direction of an edit: write the values the other side of it had.
 *
 * One command for a retype and for a move, because they are the same four
 * columns and a step must be able to put back exactly the row it found.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_MARKUP_MANAGEMENT)
@Payload({ id: "number", values: "object" })
export class SetAnnotationFieldsCommand extends Command<void> {
  constructor(
    readonly id: number,
    readonly values: AnnotationValues,
  ) {
    super();
  }
}
