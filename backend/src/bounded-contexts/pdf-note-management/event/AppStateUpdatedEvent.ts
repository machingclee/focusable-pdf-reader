import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/** The singleton settings row was patched. Null is a column that is unset. */
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({
  notesPanelWidth: "number | null",
  eventLogPanelWidth: "number | null",
  notesDocumentsWidth: "number | null",
  lastOpenedPdfDocumentId: "number | null",
})
export class AppStateUpdatedEvent extends DomainEvent {
  constructor(
    readonly notesPanelWidth: number | null,
    readonly eventLogPanelWidth: number | null,
    readonly notesDocumentsWidth: number | null,
    readonly lastOpenedPdfDocumentId: number | null,
  ) {
    super();
  }
}
