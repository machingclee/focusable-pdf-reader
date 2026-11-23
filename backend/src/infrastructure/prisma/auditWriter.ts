/**
 * Persists the command bus's audit batch into `event_audit`.
 *
 * The client is structural. This app passes the business Prisma client, so
 * `event_audit` rows land in the same database as the library. Any object with
 * the same `event_audit.createMany` shape would work. The CQRS package itself
 * only knows `AuditEventRepository`.
 *
 * The bus calls this once per top-level request, after the business transaction
 * has committed or rolled back. One `createMany` keeps the batch atomic; if the
 * write fails the bus logs it and the API result is unaffected.
 */

import type {
  AuditBatch,
  AuditEventRepository,
  AuditWriter,
} from "@machingclee/express-cqrs";

export interface AuditEventRow {
  request_id: string;
  event_type: string;
  payload: string;
  event_order: number;
  request_user_email: string | null;
  success: boolean;
  failure_reason: string;
  created_at: number;
}

/** The only Prisma-shaped surface the repository needs. */
export interface AuditEventClient {
  event_audit: {
    createMany(args: { data: AuditEventRow[] }): Promise<{ count: number }>;
  };
}

export class PrismaAuditEventRepository implements AuditWriter, AuditEventRepository {
  constructor(private readonly client: AuditEventClient) { }

  async save(batch: AuditBatch): Promise<void> {
    return this.write(batch);
  }

  async write(batch: AuditBatch): Promise<void> {
    if (batch.records.length === 0) return;

    await this.client.event_audit.createMany({
      data: batch.records.map((record) => ({
        request_id: record.requestId,
        event_type: record.type,
        payload: record.payload,
        event_order: record.order,
        request_user_email: record.actor,
        success: record.success,
        failure_reason: record.failureReason,
        created_at: record.createdAt,
      })),
    });
  }
}

/** Backwards-compatible name for the Prisma audit adapter. */
export { PrismaAuditEventRepository as PrismaAuditWriter };
