import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { CreatePdfTagFolderCommand } from "../command/CreatePdfTagFolderCommand.ts";
import { DeletePdfTagFolderCommand } from "../command/DeletePdfTagFolderCommand.ts";
import { RestorePdfTagFolderCommand } from "../command/historyReplayCommands.ts";
import { PdfTagFolderCreatedEvent } from "../event/PdfTagFolderCreatedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagFolder } from "../types.ts";

/** Append a folder to the tag catalogue. */
@CommandHandler(CreatePdfTagFolderCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService, SessionHistory],
  emits: [PdfTagFolderCreatedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class CreatePdfTagFolderCommandHandler
  implements ICommandHandler<CreatePdfTagFolderCommand, PdfTagFolder> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: CreatePdfTagFolderCommand,
    context: CommandContext,
  ): Promise<PdfTagFolder> {
    const db = this.uow.db();
    const name = this.catalog.normalize(command.input.name);
    const key = this.catalog.key(name);
    await this.catalog.assertUniqueFolder(db, key);

    const last = await db.pdf_tag_folder.aggregate({ _max: { ordering: true } });
    const folder = await db.pdf_tag_folder.create({
      data: {
        name,
        name_lower: key,
        ordering: (last._max.ordering ?? -1) + 1,
        created_at: Date.now(),
      },
    });
    context.events.add(new PdfTagFolderCreatedEvent(folder.id, folder.name));
    // The opposite of appending a folder is deleting it; redo restores the same
    // row so the tags and reorders that follow keep naming its id.
    recordHistory(context, this.history, {
      label: "Create tag folder",
      undo: new DeletePdfTagFolderCommand(folder.id),
      redo: new RestorePdfTagFolderCommand(folder, await this.folderOrder(db)),
      trashFiles: [],
    });
    return folder;
  }

  /** Every folder id, in drag order, including the one just appended. */
  private async folderOrder(db: Prisma.TransactionClient): Promise<number[]> {
    const folders = await db.pdf_tag_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    return folders.map((folder) => folder.id);
  }
}
