import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "express-prisma-cqrs";
import type { Folder } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ id: "number", name: "string" })
export class RenameFolderCommand extends Command<Folder> {
  constructor(
    readonly id: number,
    readonly name: string,
  ) {
    super();
  }
}
