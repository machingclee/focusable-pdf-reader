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
import { RenamePdfTagFolderCommand } from "../command/RenamePdfTagFolderCommand.ts";
import { PdfTagFolderRenamedEvent } from "../event/PdfTagFolderRenamedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagFolder } from "../types.ts";

@CommandHandler(RenamePdfTagFolderCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService, SessionHistory],
  emits: [PdfTagFolderRenamedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class RenamePdfTagFolderCommandHandler
  implements ICommandHandler<RenamePdfTagFolderCommand, PdfTagFolder> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: RenamePdfTagFolderCommand,
    context: CommandContext,
  ): Promise<PdfTagFolder> {
    const db = this.uow.db();
    const existing = await db.pdf_tag_folder.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`Tag folder ${command.id} does not exist`);

    const name = this.catalog.normalize(command.name);
    const key = this.catalog.key(name);
    // A rename that only changes the case is a real change and must not collide with itself.
    if (key !== existing.name_lower) await this.catalog.assertUniqueFolder(db, key, existing.id);

    const folder = await db.pdf_tag_folder.update({
      where: { id: command.id },
      data: { name, name_lower: key },
    });
    context.events.add(new PdfTagFolderRenamedEvent(folder.id, folder.name));
    // A name that did not change writes the same row again; it is not a step.
    if (folder.name !== existing.name) {
      recordHistory(context, this.history, {
        label: "Rename tag folder",
        undo: new RenamePdfTagFolderCommand(existing.id, existing.name),
        redo: command,
        trashFiles: [],
      });
    }
    return folder;
  }
}
