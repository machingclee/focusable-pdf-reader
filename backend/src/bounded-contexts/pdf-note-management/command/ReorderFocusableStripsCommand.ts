import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "express-prisma-cqrs";
import type { ReorderStripsBodySchema } from "../../../common/schemas.ts";
import type { FolderWithStrips } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ groups: "ReorderGroup[]" }, { ReorderGroup: { folder_id: "number | null", strip_ids: "number[]" } })
export class ReorderFocusableStripsCommand extends Command<FolderWithStrips[]> {
  constructor(readonly input: z.infer<typeof ReorderStripsBodySchema>) {
    super();
  }
}
