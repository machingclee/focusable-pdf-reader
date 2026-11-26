import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { CreatePdfDocumentFolderCommand } from "../command/CreatePdfDocumentFolderCommand.ts";
import { DeletePdfDocumentFolderCommand } from "../command/DeletePdfDocumentFolderCommand.ts";
import { RestorePdfDocumentFolderCommand } from "../command/historyReplayCommands.ts";
import { PdfDocumentFolderCreatedEvent } from "../event/PdfDocumentFolderCreatedEvent.ts";
import { PdfDocumentFolderService } from "../service/PdfDocumentFolderService.ts";
import type { PdfDocumentFolderView } from "../types.ts";

/** Append a folder to the Documents rail. */
@CommandHandler(CreatePdfDocumentFolderCommand, {
  inject: [PrismaUnitOfWork, PdfDocumentFolderService, SessionHistory],
  emits: [PdfDocumentFolderCreatedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class CreatePdfDocumentFolderCommandHandler
  implements ICommandHandler<CreatePdfDocumentFolderCommand, PdfDocumentFolderView> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly folders: PdfDocumentFolderService,
    private readonly history: SessionHistory,
  ) {}

  async handle(
    command: CreatePdfDocumentFolderCommand,
    context: CommandContext,
  ): Promise<PdfDocumentFolderView> {
    const db = this.uow.db();
    const name = this.folders.normalize(command.input.name);
    const key = this.folders.key(name);
    await this.folders.assertUniqueFolder(db, key);

    const last = await db.pdf_document_folder.aggregate({ _max: { ordering: true } });
    const folder = await db.pdf_document_folder.create({
      data: {
        name,
        name_lower: key,
        ordering: (last._max.ordering ?? -1) + 1,
        created_at: Date.now(),
      },
    });
    context.events.add(new PdfDocumentFolderCreatedEvent(folder.id, folder.name));
    recordHistory(context, this.history, {
      label: "Create document folder",
      undo: new DeletePdfDocumentFolderCommand(folder.id),
      redo: new RestorePdfDocumentFolderCommand(folder, await this.folderOrder(db)),
      trashFiles: [],
    });
    return this.folders.present({ ...folder, memberships: [] });
  }

  private async folderOrder(db: Prisma.TransactionClient): Promise<number[]> {
    const folders = await db.pdf_document_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    return folders.map((folder) => folder.id);
  }
}
