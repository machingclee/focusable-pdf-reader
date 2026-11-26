import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { NoteFolderWithNotes } from "../types.ts";
import { ReorderNoteFoldersBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(ReorderNoteFoldersBodySchema))
export class ReorderNoteFoldersCommand extends Command<NoteFolderWithNotes[]> {
  constructor(readonly input: z.infer<typeof ReorderNoteFoldersBodySchema>) {
    super();
  }
}
