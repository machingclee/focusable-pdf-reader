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
import { RenamePdfDocumentFolderCommand } from "../command/RenamePdfDocumentFolderCommand.ts";
import { PdfDocumentFolderRenamedEvent } from "../event/PdfDocumentFolderRenamedEvent.ts";
import { PdfDocumentFolderService } from "../service/PdfDocumentFolderService.ts";
import type { PdfDocumentFolderView } from "../types.ts";

@CommandHandler(RenamePdfDocumentFolderCommand, {
  inject: [PrismaUnitOfWork, PdfDocumentFolderService, SessionHistory],
  emits: [PdfDocumentFolderRenamedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class RenamePdfDocumentFolderCommandHandler
  implements ICommandHandler<RenamePdfDocumentFolderCommand, PdfDocumentFolderView> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly folders: PdfDocumentFolderService,
    private readonly history: SessionHistory,
  ) {}

  async handle(
    command: RenamePdfDocumentFolderCommand,
    context: CommandContext,
  ): Promise<PdfDocumentFolderView> {
    const db = this.uow.db();
    const existing = await db.pdf_document_folder.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`Document folder ${command.id} does not exist`);

    const name = this.folders.normalize(command.name);
    const key = this.folders.key(name);
    if (key !== existing.name_lower) await this.folders.assertUniqueFolder(db, key, existing.id);

    const folder = await db.pdf_document_folder.update({
      where: { id: command.id },
      data: { name, name_lower: key },
    });
    context.events.add(new PdfDocumentFolderRenamedEvent(folder.id, folder.name));
    if (folder.name !== existing.name) {
      recordHistory(context, this.history, {
        label: "Rename document folder",
        undo: new RenamePdfDocumentFolderCommand(existing.id, existing.name),
        redo: command,
        trashFiles: [],
      });
    }
    return this.folders.folder(db, folder.id);
  }
}
