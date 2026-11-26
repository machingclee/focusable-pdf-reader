import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { NoteFolder } from "../types.ts";
import { CreateNoteFolderBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(CreateNoteFolderBodySchema))
export class CreateNoteFolderCommand extends Command<NoteFolder> {
  constructor(readonly input: z.infer<typeof CreateNoteFolderBodySchema>) {
    super();
  }
}
