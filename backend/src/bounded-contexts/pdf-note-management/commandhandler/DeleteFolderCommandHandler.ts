import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "express-prisma-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { DeleteFolderCommand } from "../command/DeleteFolderCommand.ts";
import { FolderDeletedEvent } from "../event/FolderDeletedEvent.ts";

/**
 * Delete a folder. A folder that still holds strips is refused unless
 * `with_strips` is set.
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
    if (!folder) throw ErrorFactory.notFound(`Folder ${id} does not exist`);

    if (folder._count.focusable_strips > 0 && !options.withStrips) {
      throw ErrorFactory.conflict("This folder still has strips. Move or delete them first.");
    }
    await db.folder.delete({ where: { id } });


    context.events.add(new FolderDeletedEvent(command.id, command.withStrips));
  }
}