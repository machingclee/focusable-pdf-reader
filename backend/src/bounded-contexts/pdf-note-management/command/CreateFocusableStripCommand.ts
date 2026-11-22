import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "express-prisma-cqrs";
import type { FocusableStrip } from "../types.ts";
import { CreateStripBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(CreateStripBodySchema))
export class CreateFocusableStripCommand extends Command<FocusableStrip> {
  constructor(readonly input: z.infer<typeof CreateStripBodySchema>) {
    super();
  }
}
