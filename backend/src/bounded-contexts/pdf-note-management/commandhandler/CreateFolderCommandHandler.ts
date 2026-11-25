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
import { CreateFolderCommand } from "../command/CreateFolderCommand.ts";
import { DeleteFolderCommand } from "../command/DeleteFolderCommand.ts";
import { RestoreFolderCommand } from "../command/historyReplayCommands.ts";
import { FolderCreatedEvent } from "../event/FolderCreatedEvent.ts";
import { plainFolder } from "../snapshot/rows.ts";
import type { Folder } from "../types.ts";

/** Append a folder to a document. */
@CommandHandler(CreateFolderCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [FolderCreatedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class CreateFolderCommandHandler implements ICommandHandler<CreateFolderCommand, Folder> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: CreateFolderCommand, context: CommandContext): Promise<Folder> {
    const { pdf_document_id, name } = command.input;
    const db = this.uow.db();

    const document = await db.pdf_document.findUnique({ where: { id: pdf_document_id } });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${pdf_document_id} does not exist`);

    const last = await db.folder.aggregate({
      where: { pdf_document_id },
      _max: { ordering: true },
    });
    const folder = await db.folder.create({
      data: {
        pdf_document_id,
        name,
        ordering: (last._max.ordering ?? -1) + 1,
        created_at: Date.now(),
      },
    });

    context.events.add(new FolderCreatedEvent(folder.id, folder.pdf_document_id, folder.name));
    // A folder opened so a new strip has somewhere to sit belongs to that strip's step.
    if (!this.history.noteCreatedFolder(folder, context.requestId)) {
      recordHistory(context, this.history, {
        label: "Create folder",
        undo: new DeleteFolderCommand(folder.id, false),
        redo: new RestoreFolderCommand(plainFolder(folder), []),
        trashFiles: [],
      });
    }
    return folder;
  }
}
