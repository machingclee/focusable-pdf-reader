import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { CreateFolderCommand } from "../command/CreateFolderCommand.ts";
import { FolderCreatedEvent } from "../event/FolderCreatedEvent.ts";
import type { Folder } from "../types.ts";

/** Append a folder to a document. */
@CommandHandler(CreateFolderCommand, {
  inject: [PrismaUnitOfWork],
  emits: [FolderCreatedEvent],
})
export class CreateFolderCommandHandler implements ICommandHandler<CreateFolderCommand, Folder> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: CreateFolderCommand, context: CommandContext): Promise<Folder> {
    const { pdf_document_id, name } = command.input;
    const db = this.uow.db();

    const document = await db.pdf_document.findUnique({ where: { id: pdf_document_id } });
    if (!document) throw ErrorFactory.notFound(`PDF document ${pdf_document_id} does not exist`);

    const last = await db.folder.aggregate({
      where: { pdf_document_id },
      _max: { ordering: true },
    });
    const folder = await db.folder.create({
      data: {
        pdf_document_id,
        name,
        ordering: (last._max.ordering ?? -1) + 1,
        created_at: Date.now(),
      },
    });

    context.events.add(new FolderCreatedEvent(folder.id, folder.pdf_document_id, folder.name));
    return folder;
  }
}
