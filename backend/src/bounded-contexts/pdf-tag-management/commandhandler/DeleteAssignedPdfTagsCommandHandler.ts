import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { DeleteAssignedPdfTagsCommand } from "../command/DeleteAssignedPdfTagsCommand.ts";
import { AssignedPdfTagsDeletedEvent } from "../event/AssignedPdfTagsDeletedEvent.ts";

/**
 * Delete the assignment rows named by the command.
 *
 * The document is already gone when this runs, so the junction rows that pointed
 * at these assignments cascaded away with it; deleting the assignments by id
 * leaves no row belonging to nothing. An empty list is a no-op that still reports
 * itself, so the event stays the record of what the reaction saw.
 *
 * Unlike the reader commands, this records no history step of its own. It always
 * runs inside the document delete, whose step owns the undo, and a separate step
 * could not put an assignment back after the document had already gone.
 */
@CommandHandler(DeleteAssignedPdfTagsCommand, {
  inject: [PrismaUnitOfWork],
  emits: [AssignedPdfTagsDeletedEvent],
})
export class DeleteAssignedPdfTagsCommandHandler
  implements ICommandHandler<DeleteAssignedPdfTagsCommand, void> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(
    command: DeleteAssignedPdfTagsCommand,
    context: CommandContext,
  ): Promise<void> {
    const db = this.uow.db();
    const ids = [...new Set(command.assignedPdfTagIds)];
    const deleted = ids.length === 0
      ? 0
      : (await db.assigned_pdf_tag.deleteMany({ where: { id: { in: ids } } })).count;
    context.events.add(new AssignedPdfTagsDeletedEvent(command.documentId, deleted));
  }
}
