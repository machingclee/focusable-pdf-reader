import { CommandHandler, type ICommandHandler } from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ErrorFactory } from "../../../common/http.ts";
import {
  RemoveCreatedAnnotationCommand,
  RestoreAnnotationCommand,
  SetAnnotationFieldsCommand,
} from "../command/annotationReplayCommands.ts";

/**
 * The commands undo and redo send for annotations.
 *
 * Each is the exact opposite of one reader-facing command, and each is silent:
 * `recordHistory` refuses to run while a step is being applied, so an undo does
 * not push a new step onto the stack.
 */
@CommandHandler(RestoreAnnotationCommand, { inject: [PrismaUnitOfWork] })
export class RestoreAnnotationCommandHandler
  implements ICommandHandler<RestoreAnnotationCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RestoreAnnotationCommand): Promise<void> {
    const { id, pdf_document_id, page_number, x, y, width, text, created_at } = command.annotation;
    await this.uow.db().annotation.create({
      data: { id, pdf_document_id, page_number, x, y, width, text, created_at },
    });
  }
}

/** Undo of pinning a new annotation: the row the create wrote goes away. */
@CommandHandler(RemoveCreatedAnnotationCommand, { inject: [PrismaUnitOfWork] })
export class RemoveCreatedAnnotationCommandHandler
  implements ICommandHandler<RemoveCreatedAnnotationCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: RemoveCreatedAnnotationCommand): Promise<void> {
    await this.uow.db().annotation.deleteMany({ where: { id: command.id } });
  }
}

/**
 * Either direction of an edit: write the values the other side of it had.
 *
 * A retype and a move are the same four columns, so one command puts back exactly
 * the row the step found — including the case where an edit did both.
 */
@CommandHandler(SetAnnotationFieldsCommand, { inject: [PrismaUnitOfWork] })
export class SetAnnotationFieldsCommandHandler
  implements ICommandHandler<SetAnnotationFieldsCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: SetAnnotationFieldsCommand): Promise<void> {
    const db = this.uow.db();
    const existing = await db.annotation.findUnique({ where: { id: command.id }, select: { id: true } });
    if (!existing) throw ErrorFactory.ofNotFound(`Annotation ${command.id} does not exist`);
    const { page_number, x, y, width, text } = command.values;
    await db.annotation.update({
      where: { id: command.id },
      data: { page_number, x, y, width, text },
    });
  }
}
