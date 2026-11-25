import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { isDocumentHighlightList } from "../../../common/schemas.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { ReplacePdfHighlightsCommand } from "../command/ReplacePdfHighlightsCommand.ts";
import { documentHighlightJson, loadDocumentMarks, replaceDocumentHighlights } from "../highlight/marks.ts";

/**
 * Replace the strokes on a document.
 *
 * The PDF is the thing being marked, so the write names the document and the
 * whole list, not a strip. Undo puts the previous list back.
 */
@CommandHandler(ReplacePdfHighlightsCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class ReplacePdfHighlightsCommandHandler implements ICommandHandler<ReplacePdfHighlightsCommand, string> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) {}

  async handle(command: ReplacePdfHighlightsCommand, context: CommandContext): Promise<string> {
    if (!isDocumentHighlightList(command.highlights)) {
      throw ErrorFactory.ofBadRequest("highlights must be a JSON list of { page, x0, x1, y, size }");
    }
    const db = this.uow.db();
    const document = await db.pdf_document.findUnique({ where: { id: command.id }, select: { id: true } });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${command.id} does not exist`);
    const before = documentHighlightJson(await loadDocumentMarks(db, command.id));
    if (before === command.highlights) return before;
    await replaceDocumentHighlights(db, command.id, command.highlights);
    recordHistory(context, this.history, {
      label: "Highlight",
      undo: new ReplacePdfHighlightsCommand(command.id, before),
      redo: command,
      trashFiles: [],
    });
    return command.highlights;
  }
}
