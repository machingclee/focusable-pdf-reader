import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../constants.ts";
/**
 * A development-only event log.
 *
 * It exists to prove the `@Policy` / `@EventListener` path end to end in this
 * application (the audit trail is written by the bus, not by a policy). It is
 * silent unless `DOMAIN_EVENT_LOG=1`, so the packaged app's stderr stays quiet,
 * and it is excluded from the flow graph — a wildcard listener is not a domain
 * policy, and drawing it would put an edge on every event.
 */

import {
  BoundedContext,
  DomainEvent,
  EventListener,
  Policy,
  currentRequestId,
  typeNameOf,
} from "express-prisma-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
// It listens to every event, not to a domain rule, so it is left out of
// GET /docs/commands: in the diagram it would only add an edge from every node.
@Policy({ excludeFromFlow: true })
export class DomainEventLogPolicy {
  @EventListener(DomainEvent)
  log(event: DomainEvent): void {
    if (process.env.DOMAIN_EVENT_LOG !== "1") return;
    console.error(`[domain] ${typeNameOf(event)} requestId=${currentRequestId() ?? "-"}`);
  }
}
