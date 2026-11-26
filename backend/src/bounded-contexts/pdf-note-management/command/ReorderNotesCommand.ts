import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { ReorderStripsBodySchema } from "../../../common/schemas.ts";
import type { NoteFolderWithNotes } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ groups: "ReorderGroup[]" }, { ReorderGroup: { note_folder_id: "number | null", note_ids: "number[]" } })
export class ReorderNotesCommand extends Command<NoteFolderWithNotes[]> {
  constructor(readonly input: z.infer<typeof ReorderStripsBodySchema>) {
    super();
  }
}
