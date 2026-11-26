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
import { CreateNoteFolderCommand } from "../command/CreateNoteFolderCommand.ts";
import { DeleteNoteFolderCommand } from "../command/DeleteNoteFolderCommand.ts";
import { RestoreNoteFolderCommand } from "../command/historyReplayCommands.ts";
import { NoteFolderCreatedEvent } from "../event/NoteFolderCreatedEvent.ts";
import { plainNoteFolder } from "../snapshot/rows.ts";
import type { NoteFolder } from "../types.ts";

/** Append a folder to a document. */
@CommandHandler(CreateNoteFolderCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [NoteFolderCreatedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class CreateNoteFolderCommandHandler implements ICommandHandler<CreateNoteFolderCommand, NoteFolder> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: CreateNoteFolderCommand, context: CommandContext): Promise<NoteFolder> {
    const { pdf_document_id, name } = command.input;
    const db = this.uow.db();

    const document = await db.pdf_document.findUnique({ where: { id: pdf_document_id } });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${pdf_document_id} does not exist`);

    const last = await db.note_folder.aggregate({
      where: { pdf_document_id },
      _max: { ordering: true },
    });
    const folder = await db.note_folder.create({
      data: {
        pdf_document_id,
        name,
        ordering: (last._max.ordering ?? -1) + 1,
        created_at: Date.now(),
      },
    });

    context.events.add(new NoteFolderCreatedEvent(folder.id, folder.pdf_document_id, folder.name));
    // A folder opened so a new strip has somewhere to sit belongs to that strip's step.
    if (!this.history.noteCreatedFolder(folder, context.requestId)) {
      recordHistory(context, this.history, {
        label: "Create folder",
        undo: new DeleteNoteFolderCommand(folder.id, false),
        redo: new RestoreNoteFolderCommand(plainNoteFolder(folder), []),
        trashFiles: [],
      });
    }
    return folder;
  }
}
