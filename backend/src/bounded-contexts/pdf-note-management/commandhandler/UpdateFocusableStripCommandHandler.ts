import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { UpdateFocusableStripCommand } from "../command/UpdateFocusableStripCommand.ts";
import { FocusableStripUpdatedEvent } from "../event/FocusableStripUpdatedEvent.ts";
import type { FocusableStrip } from "../types.ts";

/**
 * Update a strip: the geometry the band was resized to, the markdown remark, or
 * both. One command for both because a strip is one row; neither surface may
 * clear the other's fields, hence the per-field spread instead of a whole-row
 * write.
 */
@CommandHandler(UpdateFocusableStripCommand, {
  inject: [PrismaUnitOfWork],
  emits: [FocusableStripUpdatedEvent],
})
export class UpdateFocusableStripCommandHandler implements ICommandHandler<UpdateFocusableStripCommand, FocusableStrip> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(
    command: UpdateFocusableStripCommand,
    context: CommandContext,
  ): Promise<FocusableStrip> {
    const { page_number, top, height, left, width, page_width, page_height, text_excerpt, remark } =
      command.changes;
    const db = this.uow.db();

    const existing = await db.focusable_strip.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.notFound(`Focusable strip ${command.id} does not exist`);

    const strip = await db.focusable_strip.update({
      where: { id: command.id },
      data: {
        ...(page_number === undefined ? {} : { page_number }),
        ...(top === undefined ? {} : { top }),
        ...(height === undefined ? {} : { height }),
        ...(left === undefined ? {} : { left }),
        ...(width === undefined ? {} : { width }),
        ...(page_width === undefined ? {} : { page_width }),
        ...(page_height === undefined ? {} : { page_height }),
        ...(text_excerpt === undefined ? {} : { text_excerpt }),
        ...(remark === undefined ? {} : { remark }),
      },
    });

    context.events.add(
      new FocusableStripUpdatedEvent(strip.id, strip.pdf_document_id, strip.page_number),
    );
    return strip;
  }
}
