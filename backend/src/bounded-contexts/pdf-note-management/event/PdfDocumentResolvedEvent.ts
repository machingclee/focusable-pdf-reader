import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ documentId: "number", filePath: "string", name: "string", inNewWindow: "boolean" })
export class PdfDocumentResolvedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly filePath: string,
    readonly name: string,
    /**
     * The resolve came from a window opened beside the one the reader was in.
     * That window is another look at the file, so it is not the document the
     * app should restore.
     */
    readonly inNewWindow: boolean,
  ) {
    super();
  }
}
