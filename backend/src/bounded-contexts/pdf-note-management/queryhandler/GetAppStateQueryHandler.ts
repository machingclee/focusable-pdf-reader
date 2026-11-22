import {
  QueryHandler,
  type IQueryHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { GetAppStateQuery } from "../query/GetAppStateQuery.ts";
import type { AppState } from "../types.ts";

/** The singleton settings row. A missing row is the unset shape, not a write. */
const EMPTY: AppState = {
  id: 1,
  notes_panel_width: null,
  event_log_panel_width: null,
  last_opened_pdf_document_id: null,
  updated_at: 0,
};

@QueryHandler(GetAppStateQuery, { inject: [PrismaUnitOfWork] })
export class GetAppStateQueryHandler implements IQueryHandler<GetAppStateQuery, AppState> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(): Promise<AppState> {
    const row = await this.uow.db().app_state.findUnique({ where: { id: 1 } });
    if (!row) return EMPTY;
    return {
      id: row.id,
      notes_panel_width: row.notes_panel_width,
      event_log_panel_width: row.event_log_panel_width,
      last_opened_pdf_document_id: row.last_opened_pdf_document_id,
      updated_at: row.updated_at,
    };
  }
}
