import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { StripResponse } from "../types.ts";
import { UpdateStripBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ id: "number", changes: "UpdateStripBody" }, { UpdateStripBody: payloadOf(UpdateStripBodySchema) })
export class UpdateNoteCommand extends Command<StripResponse> {
  constructor(
    readonly id: number,
    readonly changes: z.infer<typeof UpdateStripBodySchema>,
  ) {
    super();
  }
}
