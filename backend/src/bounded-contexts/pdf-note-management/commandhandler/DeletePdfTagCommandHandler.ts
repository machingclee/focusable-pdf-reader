import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { DeletePdfTagCommand } from "../command/DeletePdfTagCommand.ts";
import { PdfTagDeletedEvent } from "../event/PdfTagDeletedEvent.ts";

/** Delete a tag. Its assignment rows cascade, and their junction rows with them. */
@CommandHandler(DeletePdfTagCommand, {
  inject: [PrismaUnitOfWork],
  emits: [PdfTagDeletedEvent],
})
export class DeletePdfTagCommandHandler implements ICommandHandler<DeletePdfTagCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: DeletePdfTagCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const tag = await db.pdf_tag.findUnique({
      where: { id: command.id },
      include: { _count: { select: { assignments: true } } },
    });
    if (!tag) throw ErrorFactory.ofNotFound(`PDF tag ${command.id} does not exist`);

    await db.pdf_tag.delete({ where: { id: command.id } });
    context.events.add(new PdfTagDeletedEvent(tag.id, tag._count.assignments));
  }
}
