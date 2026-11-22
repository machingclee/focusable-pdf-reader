import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { SetAppStateCommand } from "../bounded-contexts/pdf-note-management/command/SetAppStateCommand.ts";
import { GetAppStateQuery } from "../bounded-contexts/pdf-note-management/query/GetAppStateQuery.ts";
import { AppStateMapSchema, SetAppStateBodySchema, ErrorResponse } from "../common/schemas.ts";

/**
 * `/app-state` - UI state that has to survive a restart.
 *
 * One row per setting, keyed by a dotted name (`notes_panel.width`). Values are
 * strings so remembering one more thing never needs a migration; the reader
 * parses what it wrote and falls back to a default when it cannot.
 */
export const appStateRouter = createDocRouter("/app-state");

/** Every remembered value, as a flat `key -> value` map. */
appStateRouter.get(
  "/",
  {
    responseSchema: AppStateMapSchema,
    summary: "Read all remembered UI state as a key/value map",
    tags: ["app-state"],
  },
  async (req, res) => {
    res.json(await req.queryBus.send(new GetAppStateQuery()));
  },
);

/** Write one value. Creates the key on first use. */
appStateRouter.put(
  "/:key",
  {
    bodySchema: SetAppStateBodySchema,
    responseSchema: z.object({
      key: z.string(),
      value: z.string(),
      updated_at: z.number(),
    }),
    summary: "Remember one value under a key",
    tags: ["app-state"],
    responses: { 400: { description: "Invalid body", schema: ErrorResponse } },
  },
  async (req, res) => {
    // Express types a route param as possibly repeated; `/:key` is one segment.
    const key = String(req.params.key ?? "");
    res.json(await req.commandBus.send(new SetAppStateCommand(key, req.body.value)));
  },
);
