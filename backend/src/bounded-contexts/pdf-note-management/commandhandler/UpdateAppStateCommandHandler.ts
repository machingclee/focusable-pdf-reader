import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { UpdateAppStateCommand } from "../command/UpdateAppStateCommand.ts";
import { AppStateUpdatedEvent } from "../event/AppStateUpdatedEvent.ts";
import type { AppState } from "../types.ts";

/** The only settings row. The check constraint refuses any other id. */
const APP_STATE_ID = 1;

/** Patch the singleton settings row, creating it the first time. */
@CommandHandler(UpdateAppStateCommand, {
  inject: [PrismaUnitOfWork],
  emits: [AppStateUpdatedEvent],
})
export class UpdateAppStateCommandHandler implements ICommandHandler<UpdateAppStateCommand, AppState> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: UpdateAppStateCommand, context: CommandContext): Promise<AppState> {
    const { notes_panel_width, event_log_panel_width, last_opened_pdf_document_id } = command.input;
    if (
      notes_panel_width === undefined &&
      event_log_panel_width === undefined &&
      last_opened_pdf_document_id === undefined
    ) {
      throw ErrorFactory.ofBadRequest("Update app state needs at least one field");
    }

    const db = this.uow.db();
    if (last_opened_pdf_document_id != null) {
      const document = await db.pdf_document.findUnique({
        where: { id: last_opened_pdf_document_id },
        select: { id: true },
      });
      if (!document) {
        throw ErrorFactory.ofNotFound(`PDF document ${last_opened_pdf_document_id} does not exist`);
      }
    }

    const now = Date.now();
    const row = await db.app_state.upsert({
      where: { id: APP_STATE_ID },
      create: {
        id: APP_STATE_ID,
        notes_panel_width: notes_panel_width ?? null,
        event_log_panel_width: event_log_panel_width ?? null,
        last_opened_pdf_document_id: last_opened_pdf_document_id ?? null,
        updated_at: now,
      },
      update: {
        ...(notes_panel_width === undefined ? {} : { notes_panel_width }),
        ...(event_log_panel_width === undefined ? {} : { event_log_panel_width }),
        ...(last_opened_pdf_document_id === undefined ? {} : { last_opened_pdf_document_id }),
        updated_at: now,
      },
    });

    context.events.add(
      new AppStateUpdatedEvent(
        row.notes_panel_width,
        row.event_log_panel_width,
        row.last_opened_pdf_document_id,
      ),
    );
    return {
      id: row.id,
      notes_panel_width: row.notes_panel_width,
      event_log_panel_width: row.event_log_panel_width,
      last_opened_pdf_document_id: row.last_opened_pdf_document_id,
      updated_at: row.updated_at,
    };
  }
}
