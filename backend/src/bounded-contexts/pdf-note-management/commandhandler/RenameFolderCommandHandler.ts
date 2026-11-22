import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "express-prisma-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { RenameFolderCommand } from "../command/RenameFolderCommand.ts";
import { FolderRenamedEvent } from "../event/FolderRenamedEvent.ts";
import type { Folder } from "../types.ts";

@CommandHandler(RenameFolderCommand, {
  inject: [PrismaUnitOfWork],
  emits: [FolderRenamedEvent],
})
export class RenameFolderCommandHandler implements ICommandHandler<RenameFolderCommand, Folder> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RenameFolderCommand, context: CommandContext): Promise<Folder> {
    const db = this.uow.db();
    const existing = await db.folder.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.notFound(`Folder ${command.id} does not exist`);

    const folder = await db.folder.update({
      where: { id: command.id },
      data: { name: command.name },
    });
    context.events.add(new FolderRenamedEvent(folder.id, folder.pdf_document_id, folder.name));
    return folder;
  }
}
