import { CONTEXT_PDF_MARKUP_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";

/** Replace every yellow stroke on a document. The answer is the list that landed. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_MARKUP_MANAGEMENT)
@Payload({ id: "number", highlights: "string" })
export class ReplacePdfHighlightsCommand extends Command<string> {
  constructor(
    readonly id: number,
    readonly highlights: string,
  ) {
    super();
  }
}
