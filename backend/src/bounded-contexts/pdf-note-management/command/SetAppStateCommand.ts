import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "express-prisma-cqrs";
import type { AppStateRow } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ key: "string", value: "string" })
export class SetAppStateCommand extends Command<AppStateRow> {
  constructor(
    readonly key: string,
    readonly value: string,
  ) {
    super();
  }
}
