import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { FolderWithStrips } from "../types.ts";
import { ReorderFoldersBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(ReorderFoldersBodySchema))
export class ReorderFoldersCommand extends Command<FolderWithStrips[]> {
  constructor(readonly input: z.infer<typeof ReorderFoldersBodySchema>) {
    super();
  }
}
