import { createDocRouter } from "../docs/routeRegistry.ts";
import { prisma } from "../infrastructure/prisma/instance.ts";
import { ErrorFactory } from "../common/http.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import {
  AuditEventsQuerySchema,
  AuditEventsResponseSchema,
  ErrorResponse,
} from "../common/schemas.ts";

/**
 * `/event-audit` — read-only query over the persisted command/event rows.
 *
 * The table is append-only and lives in the business database. This router
 * reads it through the root Prisma client; it never opens a command
 * transaction.
 */
export const eventAuditRouter = createDocRouter("/event-audit");

eventAuditRouter.get(
  "/",
  {
    querySchema: AuditEventsQuerySchema,
    responseSchema: AuditEventsResponseSchema,
    responses: { 400: { description: "Invalid query parameters", schema: ErrorResponse } },
    summary: "Query command and event audit rows",
    tags: ["event-audit"],
  },
  async (req, res) => {
    const parsed = AuditEventsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ErrorFactory.badRequest(
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }

    const { page, limit, requestId, eventType, success, sortOrder } = parsed.data;
    const where: Prisma.event_auditWhereInput = {
      ...(requestId ? { request_id: { contains: requestId } } : {}),
      ...(eventType ? { event_type: { contains: eventType } } : {}),
      ...(success === undefined ? {} : { success: success === "true" }),
    };

    const [rows, total] = await Promise.all([
      prisma().event_audit.findMany({
        where,
        orderBy: [{ created_at: sortOrder ?? "desc" }, { event_order: "asc" }],
        skip: page * limit,
        take: limit,
      }),
      prisma().event_audit.count({ where }),
    ]);

    res.json({
      events: rows.map((row) => ({
        id: row.id,
        requestId: row.request_id,
        eventType: row.event_type,
        payload: row.payload,
        eventOrder: row.event_order,
        requestUserEmail: row.request_user_email,
        success: row.success,
        failureReason: row.failure_reason,
        createdAt: row.created_at,
      })),
      total,
      page,
      limit,
    });
  },
);
