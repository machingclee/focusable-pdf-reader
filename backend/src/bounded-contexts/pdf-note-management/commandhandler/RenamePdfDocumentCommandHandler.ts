import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { RenamePdfDocumentCommand } from "../command/RenamePdfDocumentCommand.ts";
import { PdfDocumentRenamedEvent } from "../event/PdfDocumentRenamedEvent.ts";
import { HistoryStepReadyEvent } from "../event/HistoryStepReadyEvent.ts";
import { recordHistory } from "../history/recordHistory.ts";
import { SessionHistory } from "../history/SessionHistory.ts";
import type { PdfDocument } from "../types.ts";

@CommandHandler(RenamePdfDocumentCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [PdfDocumentRenamedEvent, HistoryStepReadyEvent],
  afterCommit: [HistoryStepReadyEvent],
})
export class RenamePdfDocumentCommandHandler implements ICommandHandler<RenamePdfDocumentCommand, PdfDocument> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: RenamePdfDocumentCommand,
    context: CommandContext,
  ): Promise<PdfDocument> {
    const db = this.uow.db();
    const existing = await db.pdf_document.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`PDF document ${command.id} does not exist`);

    const document = await db.pdf_document.update({
      where: { id: command.id },
      data: { name: command.name },
    });
    context.events.add(new PdfDocumentRenamedEvent(document.id, document.name));
    if (existing.name !== command.name) {
      recordHistory(context, this.history, {
        label: "Rename document",
        undo: new RenamePdfDocumentCommand(existing.id, existing.name),
        redo: command,
        trashFiles: [],
      });
    }
    return document;
  }
}
