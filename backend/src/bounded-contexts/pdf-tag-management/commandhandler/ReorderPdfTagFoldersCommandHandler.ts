import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { assertSameIds } from "../../common/ids.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { ReorderPdfTagFoldersCommand } from "../command/ReorderPdfTagFoldersCommand.ts";
import { PdfTagFoldersReorderedEvent } from "../event/PdfTagFoldersReorderedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagFolder } from "../types.ts";

/** Apply a drag of the tag-folder list. */
@CommandHandler(ReorderPdfTagFoldersCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService, SessionHistory],
  emits: [PdfTagFoldersReorderedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class ReorderPdfTagFoldersCommandHandler
  implements ICommandHandler<ReorderPdfTagFoldersCommand, PdfTagFolder[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: ReorderPdfTagFoldersCommand,
    context: CommandContext,
  ): Promise<PdfTagFolder[]> {
    const db = this.uow.db();
    const existing = await db.pdf_tag_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const previousIds = existing.map((folder) => folder.id);
    assertSameIds(
      previousIds,
      command.input.pdf_tag_folder_ids,
      "pdf_tag_folder_ids must list every tag folder once",
    );

    for (const [ordering, id] of command.input.pdf_tag_folder_ids.entries()) {
      await db.pdf_tag_folder.update({ where: { id }, data: { ordering } });
    }
    context.events.add(new PdfTagFoldersReorderedEvent(command.input.pdf_tag_folder_ids.length));
    // A drop that lands the list where it already was is not a step.
    if (!sameSequence(previousIds, command.input.pdf_tag_folder_ids)) {
      recordHistory(context, this.history, {
        label: "Reorder tag folders",
        undo: new ReorderPdfTagFoldersCommand({ pdf_tag_folder_ids: previousIds }),
        redo: command,
        trashFiles: [],
      });
    }
    return this.catalog.listFolders(db);
  }
}

function sameSequence(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
