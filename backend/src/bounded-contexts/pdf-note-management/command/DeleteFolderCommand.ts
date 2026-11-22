import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "express-prisma-cqrs";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ id: "number", withStrips: "boolean" })
export class DeleteFolderCommand extends Command<void> {
  constructor(
    readonly id: number,
    readonly withStrips: boolean,
  ) {
    super();
  }
}
