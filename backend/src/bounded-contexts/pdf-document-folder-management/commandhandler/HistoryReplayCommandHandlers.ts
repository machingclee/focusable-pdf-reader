import { CommandHandler, type ICommandHandler } from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { RestorePdfDocumentFolderCommand } from "../command/historyReplayCommands.ts";

/**
 * Redo of creating a document folder, or undo of deleting one.
 *
 * The row is written with the id it had; `order` then rewrites every folder's
 * position, because the delete that this undoes left the survivors dense.
 */
@CommandHandler(RestorePdfDocumentFolderCommand, { inject: [PrismaUnitOfWork] })
export class RestorePdfDocumentFolderCommandHandler
  implements ICommandHandler<RestorePdfDocumentFolderCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async handle(command: RestorePdfDocumentFolderCommand): Promise<void> {
    const db = this.uow.db();
    await db.pdf_document_folder.create({ data: command.folder });
    for (const [ordering, id] of command.order.entries()) {
      await db.pdf_document_folder.update({ where: { id }, data: { ordering } });
    }
  }
}
