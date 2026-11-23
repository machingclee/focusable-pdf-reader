import { getCqrsModule } from "@machingclee/express-cqrs";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { ApplyHistoryCommand } from "../bounded-contexts/pdf-note-management/command/ApplyHistoryCommand.ts";
import { SessionHistory } from "../bounded-contexts/pdf-note-management/history/SessionHistory.ts";
import { ErrorResponse, HistoryStatusSchema } from "../common/schemas.ts";

/**
 * `/history` — the session undo and redo stack.
 *
 * The stack lives in the backend process. An empty stack answers 409, which the
 * window treats as a quiet no-op.
 */
export const historyRouter = createDocRouter("/history");

historyRouter.post(
  "/undo",
  {
    responseSchema: HistoryStatusSchema,
    summary: "Undo the latest library change",
    tags: ["history"],
    responses: {
      409: { description: "Nothing to undo", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const history = getCqrsModule().container.resolve(SessionHistory);
    const status = await history.runExclusive(() => req.commandBus.send(new ApplyHistoryCommand("undo")));
    res.json(status);
  },
);

historyRouter.post(
  "/redo",
  {
    responseSchema: HistoryStatusSchema,
    summary: "Redo the latest undone library change",
    tags: ["history"],
    responses: {
      409: { description: "Nothing to redo", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const history = getCqrsModule().container.resolve(SessionHistory);
    const status = await history.runExclusive(() => req.commandBus.send(new ApplyHistoryCommand("redo")));
    res.json(status);
  },
);
