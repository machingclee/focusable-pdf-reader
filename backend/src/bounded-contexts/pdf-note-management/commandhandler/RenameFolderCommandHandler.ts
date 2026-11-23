import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { RenameFolderCommand } from "../command/RenameFolderCommand.ts";
import { FolderRenamedEvent } from "../event/FolderRenamedEvent.ts";
import { HistoryStepReadyEvent } from "../event/HistoryStepReadyEvent.ts";
import { recordHistory } from "../history/recordHistory.ts";
import { SessionHistory } from "../history/SessionHistory.ts";
import type { Folder } from "../types.ts";

@CommandHandler(RenameFolderCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [FolderRenamedEvent, HistoryStepReadyEvent],
  afterCommit: [HistoryStepReadyEvent],
})
export class RenameFolderCommandHandler implements ICommandHandler<RenameFolderCommand, Folder> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: RenameFolderCommand, context: CommandContext): Promise<Folder> {
    const db = this.uow.db();
    const existing = await db.folder.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`Folder ${command.id} does not exist`);

    const folder = await db.folder.update({
      where: { id: command.id },
      data: { name: command.name },
    });
    context.events.add(new FolderRenamedEvent(folder.id, folder.pdf_document_id, folder.name));
    if (existing.name !== command.name) {
      recordHistory(context, this.history, {
        label: "Rename folder",
        undo: new RenameFolderCommand(existing.id, existing.name),
        redo: command,
        trashFiles: [],
      });
    }
    return folder;
  }
}
