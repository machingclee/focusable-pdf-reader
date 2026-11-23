import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { DeleteFocusableStripCommand } from "../command/DeleteFocusableStripCommand.ts";
import { RestoreFocusableStripCommand } from "../command/historyReplayCommands.ts";
import { FocusableStripDeletedEvent } from "../event/FocusableStripDeletedEvent.ts";
import { HistoryStepReadyEvent } from "../event/HistoryStepReadyEvent.ts";
import { recordHistory } from "../history/recordHistory.ts";
import { plainStrip } from "../history/rows.ts";
import { SessionHistory } from "../history/SessionHistory.ts";

@CommandHandler(DeleteFocusableStripCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [FocusableStripDeletedEvent, HistoryStepReadyEvent],
  afterCommit: [HistoryStepReadyEvent],
})
export class DeleteFocusableStripCommandHandler implements ICommandHandler<DeleteFocusableStripCommand> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: DeleteFocusableStripCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const existing = await db.focusable_strip.findUnique({
      where: { id: command.id },
    });
    if (!existing) throw ErrorFactory.ofNotFound(`Focusable strip ${command.id} does not exist`);

    await db.focusable_strip.delete({ where: { id: command.id } });
    context.events.add(
      new FocusableStripDeletedEvent(existing.id, existing.pdf_document_id, existing.folder_id),
    );
    recordHistory(context, this.history, {
      label: "Delete strip",
      undo: new RestoreFocusableStripCommand(plainStrip(existing)),
      redo: command,
      trashFiles: [],
    });
  }
}
