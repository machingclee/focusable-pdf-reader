import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Query } from "@machingclee/express-cqrs";
import type { AppState } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
export class GetAppStateQuery extends Query<AppState> { }
