import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { FocusableStrip } from "../types.ts";

/** File a strip into a folder. Sent by the policy that opens the default folder. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ stripId: "number", folderId: "number" })
export class AssignFocusableStripFolderCommand extends Command<FocusableStrip> {
  constructor(
    readonly stripId: number,
    readonly folderId: number,
  ) {
    super();
  }
}
