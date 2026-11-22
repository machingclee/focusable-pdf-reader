import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { Folder } from "../types.ts";
import { CreateFolderBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(CreateFolderBodySchema))
export class CreateFolderCommand extends Command<Folder> {
  constructor(readonly input: z.infer<typeof CreateFolderBodySchema>) {
    super();
  }
}
