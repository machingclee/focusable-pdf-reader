import {
  CommandBus,
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { ApplyHistoryCommand } from "../command/ApplyHistoryCommand.ts";
import { HistoryAppliedEvent } from "../event/HistoryAppliedEvent.ts";
import { SessionHistory, type HistoryStatus } from "../service/SessionHistory.ts";

/**
 * Apply the latest undo or redo step by sending the command that was stored
 * for it. Recording stays off for that nested command, so it does not push a
 * new opposite. The step changes stacks after this transaction commits.
 */
@CommandHandler(ApplyHistoryCommand, {
  inject: [SessionHistory, CommandBus],
  emits: [HistoryAppliedEvent],
  afterCommit: [HistoryAppliedEvent],
})
export class ApplyHistoryCommandHandler implements ICommandHandler<ApplyHistoryCommand, HistoryStatus> {
  constructor(
    private readonly history: SessionHistory,
    private readonly commandBus: CommandBus,
  ) { }

  async handle(command: ApplyHistoryCommand, context: CommandContext): Promise<HistoryStatus> {
    const step = this.history.peek(command.direction);
    if (!step) {
      throw ErrorFactory.ofConflict(command.direction === "undo" ? "Nothing to undo" : "Nothing to redo");
    }

    const status = this.history.statusAfter(command.direction);
    this.history.beginApply();
    try {
      await this.commandBus.send(command.direction === "undo" ? step.undo : step.redo);
      context.events.addTransactional(new HistoryAppliedEvent(command.direction));
    } finally {
      this.history.endApply();
    }
    return status;
  }
}
