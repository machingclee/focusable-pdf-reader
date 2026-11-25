import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { AssignFocusableStripFolderCommand } from "../command/AssignFocusableStripFolderCommand.ts";
import { PlaceFocusableStripCommand } from "../command/historyReplayCommands.ts";
import { FocusableStripFolderAssignedEvent } from "../event/FocusableStripFolderAssignedEvent.ts";
import type { FocusableStrip } from "../types.ts";

/** Put a strip at the end of a folder on the same document. */
@CommandHandler(AssignFocusableStripFolderCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [FocusableStripFolderAssignedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class AssignFocusableStripFolderCommandHandler
  implements ICommandHandler<AssignFocusableStripFolderCommand, FocusableStrip> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: AssignFocusableStripFolderCommand,
    context: CommandContext,
  ): Promise<FocusableStrip> {
    const db = this.uow.db();
    const strip = await db.focusable_strip.findUnique({ where: { id: command.stripId } });
    if (!strip) throw ErrorFactory.ofNotFound(`Focusable strip ${command.stripId} does not exist`);

    const folder = await db.folder.findUnique({ where: { id: command.folderId } });
    if (!folder || folder.pdf_document_id !== strip.pdf_document_id) {
      throw ErrorFactory.ofNotFound(
        `Folder ${command.folderId} does not exist on document ${strip.pdf_document_id}`,
      );
    }

    const last = await db.focusable_strip.aggregate({
      where: { folder_id: folder.id },
      _max: { ordering: true },
    });
    const filed = await db.focusable_strip.update({
      where: { id: strip.id },
      data: {
        folder_id: folder.id,
        ordering: (last._max.ordering ?? -1) + 1,
      },
    });

    context.events.add(
      new FocusableStripFolderAssignedEvent(filed.id, filed.pdf_document_id, folder.id),
    );
    if (!this.history.noteAssigned(filed, context.requestId)) {
      recordHistory(context, this.history, {
        label: "Move strip",
        undo: new PlaceFocusableStripCommand(strip.id, strip.folder_id, strip.ordering),
        redo: command,
        trashFiles: [],
      });
    }
    return filed;
  }
}
