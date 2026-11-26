import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { NoteFolder } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ id: "number", name: "string" })
export class RenameNoteFolderCommand extends Command<NoteFolder> {
  constructor(
    readonly id: number,
    readonly name: string,
  ) {
    super();
  }
}
