import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { Note } from "../types.ts";
import { CreateStripBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(CreateStripBodySchema))
export class CreateNoteCommand extends Command<Note> {
  constructor(readonly input: z.infer<typeof CreateStripBodySchema>) {
    super();
  }
}
