import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { DeleteFocusableStripCommand } from "../command/DeleteFocusableStripCommand.ts";
import { FocusableStripDeletedEvent } from "../event/FocusableStripDeletedEvent.ts";

@CommandHandler(DeleteFocusableStripCommand, {
  inject: [PrismaUnitOfWork],
  emits: [FocusableStripDeletedEvent],
})
export class DeleteFocusableStripCommandHandler implements ICommandHandler<DeleteFocusableStripCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: DeleteFocusableStripCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const existing = await db.focusable_strip.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`Focusable strip ${command.id} does not exist`);

    await db.focusable_strip.delete({ where: { id: command.id } });
    context.events.add(
      new FocusableStripDeletedEvent(existing.id, existing.pdf_document_id, existing.folder_id),
    );
  }
}
