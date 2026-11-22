import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "express-prisma-cqrs";
import type { FocusableStrip } from "../types.ts";
import { UpdateStripBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ id: "number", changes: "UpdateStripBody" }, { UpdateStripBody: payloadOf(UpdateStripBodySchema) })
export class UpdateFocusableStripCommand extends Command<FocusableStrip> {
  constructor(
    readonly id: number,
    readonly changes: z.infer<typeof UpdateStripBodySchema>,
  ) {
    super();
  }
}
