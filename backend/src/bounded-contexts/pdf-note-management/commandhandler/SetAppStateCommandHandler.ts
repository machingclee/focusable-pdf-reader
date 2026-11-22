import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "express-prisma-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { SetAppStateCommand } from "../command/SetAppStateCommand.ts";
import { AppStateValueSetEvent } from "../event/AppStateValueSetEvent.ts";
import type { AppStateRow } from "../types.ts";

/** Write one value. Creates the key on first use. */
@CommandHandler(SetAppStateCommand, { inject: [PrismaUnitOfWork], emits: [AppStateValueSetEvent] })
export class SetAppStateCommandHandler implements ICommandHandler<SetAppStateCommand, AppStateRow> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: SetAppStateCommand, context: CommandContext): Promise<AppStateRow> {
    const db = this.uow.db();
    const now = Date.now();
    const row = await db.app_state.upsert({
      where: { key: command.key },
      create: { key: command.key, value: command.value, updated_at: now },
      update: { value: command.value, updated_at: now },
    });

    context.events.add(new AppStateValueSetEvent(row.key));
    return row;
  }
}
