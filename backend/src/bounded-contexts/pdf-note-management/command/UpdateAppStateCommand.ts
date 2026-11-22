import type { z } from "zod";
import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import { UpdateAppStateBodySchema, payloadOf } from "../../../common/schemas.ts";
import type { AppState } from "../types.ts";

/**
 * Patch the singleton settings row.
 *
 * Only the fields present on the command are written. The policy that remembers
 * the last resolved document sends just that id, and a panel-width drag sends
 * just that width.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(UpdateAppStateBodySchema))
export class UpdateAppStateCommand extends Command<AppState> {
  constructor(readonly input: z.infer<typeof UpdateAppStateBodySchema>) {
    super();
  }
}
