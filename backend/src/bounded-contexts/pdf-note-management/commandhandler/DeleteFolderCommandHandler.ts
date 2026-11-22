import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { DeleteFolderCommand } from "../command/DeleteFolderCommand.ts";
import { FolderDeletedEvent } from "../event/FolderDeletedEvent.ts";

/**
 * Delete a folder.
 *
 * The rule that a folder holding notes needs an explicit `with_strips` belongs
 * here: this is the only place that sees both the note count and the command
 * that asked for the delete. The count is read before the delete, because the
 * cascade removes the notes with the folder.
 */
@CommandHandler(DeleteFolderCommand, {
  inject: [PrismaUnitOfWork],
  emits: [FolderDeletedEvent],
})
export class DeleteFolderCommandHandler implements ICommandHandler<DeleteFolderCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: DeleteFolderCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const folderId = command.id;
    const folder = await db.folder.findUnique({
      where: { id: folderId },
      include: { _count: { select: { focusable_strips: true } } },
    });
    if (!folder) throw ErrorFactory.notFound(`Folder ${folderId} does not exist`);

    const noteCount = folder._count.focusable_strips;
    if (noteCount > 0 && !command.withStrips) {
      throw ErrorFactory.conflict("This folder still has strips. Move or delete them first.");
    }

    await db.folder.delete({ where: { id: folderId } });

    context.events.add(new FolderDeletedEvent(folderId, noteCount));
  }
}
