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
import { RenameNoteFolderCommand } from "../command/RenameNoteFolderCommand.ts";
import { NoteFolderRenamedEvent } from "../event/NoteFolderRenamedEvent.ts";
import type { NoteFolder } from "../types.ts";

@CommandHandler(RenameNoteFolderCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [NoteFolderRenamedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class RenameNoteFolderCommandHandler implements ICommandHandler<RenameNoteFolderCommand, NoteFolder> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: RenameNoteFolderCommand, context: CommandContext): Promise<NoteFolder> {
    const db = this.uow.db();
    const existing = await db.note_folder.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`NoteFolder ${command.id} does not exist`);

    const folder = await db.note_folder.update({
      where: { id: command.id },
      data: { name: command.name },
    });
    context.events.add(new NoteFolderRenamedEvent(folder.id, folder.pdf_document_id, folder.name));
    if (existing.name !== command.name) {
      recordHistory(context, this.history, {
        label: "Rename folder",
        undo: new RenameNoteFolderCommand(existing.id, existing.name),
        redo: command,
        trashFiles: [],
      });
    }
    return folder;
  }
}
