---
name: cqrs
description: >-
  Add a Command, Command Handler, Domain Event and optional Policy reaction to
  the PdfNoteManagement bounded context in this Bun/Express/Prisma backend. Use
  when adding a write endpoint or business action that goes through CommandBus,
  creating a domain event, adding a policy listener, or wiring new handlers into
  PDF_NOTE_MANAGEMENT_COMPONENTS.
---

# Add a Command and Policy to PdfNoteManagement

This skill describes the local conventions of this repository. Read the actual
files before editing; this backend has one bounded context and a deliberately
explicit component list.

## Read first

- `express-prisma-cqrs` for the decorators, buses, container, events,
  audit and module assembly.
- `backend/src/contexts/pdfNoteManagement/components.ts` for the component list.
- `backend/src/contexts/pdfNoteManagement/command/`,
  `commandhandler/`, `event/` and `policy/` for existing examples.
- `express-prisma-cqrs` for the module singleton and startup guard.
- `backend/src/routers/` for the Express route conventions.
- `backend/README.md` for transactions and the audit database.

## Non-negotiable rules

- Use one class per file.
- Put commands in `command/`, handlers in `commandhandler/`, events in `event/`,
  and policies in `policy/`.
- Use `@Actor("Reader")` and `@BoundedContext("PdfNoteManagement")` on every
  command, query and event.
- Every command handler uses the default `required` transaction mode. Do not add
  `@Transactional({ mode: "none" })` in this application.
- `@Invariant` belongs only on a `@Policy` method that also carries
  `@EventListener`. Do not put it on a command handler.
- Add the handler and any policy to `PDF_NOTE_MANAGEMENT_COMPONENTS`. There is no
  classpath scan.
- `inject` order must match the constructor order.
- `emits` is metadata for validation and the flow graph. Actually emit through
  `context.events.add(...)` or `context.events.addTransactional(...)`.
- Use `this.uow.db()` for every Prisma call. Do not call `$transaction` inside a
  handler.

## Entrypoint

`initializeCqrs` stores the module created by `createCqrs` with the component list,
the Prisma audit repository and an optional transaction runner. A consumer of
the reusable package does not build a `Container` by hand:

```ts
const cqrs = createCqrs({
  components: PDF_NOTE_MANAGEMENT_COMPONENTS,
  auditEventRepository: new PrismaAuditEventRepository(db),
  transactionRunner: unitOfWork,
  configure: (container) => {
    container.registerValue(PrismaUnitOfWork, unitOfWork);
  },
});

app.use(attachCqrs(cqrs));
```

The component list is required. The audit repository is optional; omit it when
there is no audit database. The transaction runner and `configure` callback are
optional, but this Prisma-backed context uses both so handlers can inject
`PrismaUnitOfWork`.

## Create a command

Create `command/<Name>Command.ts`:

```ts
import { Actor, BoundedContext, Command } from "express-prisma-cqrs";
import type { PdfDocument } from "../types.ts";

@Actor("Reader")
@BoundedContext("PdfNoteManagement")
export class ArchivePdfDocumentCommand extends Command<PdfDocument> {
  constructor(readonly id: number) {
    super();
  }
}
```

The result type is the value returned by `commandBus.send`. Use `void` when the
command has no useful result.

## Create an event when the handler emits one

Create `event/<Name>.ts`:

```ts
import { BoundedContext, DomainEvent } from "express-prisma-cqrs";

@BoundedContext("PdfNoteManagement")
export class PdfDocumentArchived extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly previousName: string,
  ) {
    super();
  }
}
```

Use names that describe the past event. Keep identifiers and fields that an audit
reader needs. Do not put a full database row in the event.

## Create the handler

Create `commandhandler/<Name>CommandHandler.ts`:

```ts
import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "express-prisma-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ArchivePdfDocumentCommand } from "../command/ArchivePdfDocumentCommand.ts";
import { PdfDocumentArchived } from "../event/PdfDocumentArchived.ts";
import type { PdfDocument } from "../types.ts";

@CommandHandler(ArchivePdfDocumentCommand, {
  inject: [PrismaUnitOfWork],
  emits: [PdfDocumentArchived],
})
export class ArchivePdfDocumentCommandHandler implements ICommandHandler<
  ArchivePdfDocumentCommand,
  PdfDocument
> {
  constructor(private readonly uow: PrismaUnitOfWork) {}

  async handle(
    command: ArchivePdfDocumentCommand,
    context: CommandContext,
  ): Promise<PdfDocument> {
    const db = this.uow.db();
    const document = await db.pdf_document.findUnique({
      where: { id: command.id },
    });
    if (!document) throw ErrorFactory.notFound(`PDF document ${command.id} does not exist`);

    const updated = await db.pdf_document.update({
      where: { id: command.id },
      data: { name: `${document.name} (archived)` },
    });

    context.events.add(new PdfDocumentArchived(updated.id, document.name));
    return updated;
  }
}
```

For a file-copy or external side effect, keep the command required and follow
the existing import handler pattern. Do not add a new `mode: "none"` exception
without an explicit decision.

## Register the handler

Add the handler to `PDF_NOTE_MANAGEMENT_COMPONENTS` in
`contexts/pdfNoteManagement/components.ts`.

```ts
export const PDF_NOTE_MANAGEMENT_COMPONENTS = [
  ArchivePdfDocumentCommandHandler,
  // ...
];
```

A handler that is not in this list has no runtime registration.

## Add the route

Use the existing router style. Validate the body with Zod, return the existing
response schema, and send the command through `req.commandBus`.

```ts
pdfDocumentRouter.post(
  "/:id/archive",
  {
    bodySchema: ArchivePdfDocumentBodySchema,
    responseSchema: PdfDocumentSchema,
    summary: "Archive a PDF document",
    tags: ["pdf-documents"],
  },
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    res.json(await req.commandBus.send(new ArchivePdfDocumentCommand(id)));
  },
);
```

Keep HTTP validation in the router and invariants in the domain. The command does
not validate again.

## Add a policy reaction

A policy is useful when an event should trigger another command. Create
`policy/<Name>Policy.ts`:

```ts
import {
  BoundedContext,
  CommandBus,
  EventListener,
  Invariant,
  Policy,
} from "express-prisma-cqrs";
import { CreateFolderCommand } from "../command/CreateFolderCommand.ts";
import { PdfDocumentArchived } from "../event/PdfDocumentArchived.ts";

@BoundedContext("PdfNoteManagement")
@Policy({ inject: [CommandBus] })
export class PdfDocumentArchivePolicy {
  constructor(private readonly commandBus: CommandBus) {}

  @EventListener(PdfDocumentArchived, {
    sends: [CreateFolderCommand],
  })
  @Invariant("an archived document keeps a default folder for future notes")
  async onArchived(event: PdfDocumentArchived): Promise<void> {
    await this.commandBus.send(
      new CreateFolderCommand({
        pdf_document_id: event.documentId,
        name: "Archive",
      }),
    );
  }
}
```

Add the policy to `PDF_NOTE_MANAGEMENT_COMPONENTS` as well.

`context.events.add(event)` dispatches before commit, so a nested command shares
the parent transaction. `context.events.addTransactional(event)` dispatches
after commit, so a command sent by that listener opens a new transaction. Choose
the timing deliberately. `@Invariant` documents why the policy routes the event;
it does not enforce the rule at runtime.

## Verify

Run:

```bash
cd backend
bun check
bun test
```

Also send a real request and read `GET /docs/commands`. Confirm:

- the command appears with the expected handler;
- the event appears under `PdfNoteManagement`;
- the policy appears with its `sends` edge;
- the policy invariant appears under `invariants`;
- the audit rows land in `audit.db`, not the business database.

## Common failures

- Handler exists but is missing from `components.ts`.
- `inject` order does not match constructor order.
- `@Invariant` was added to a command handler; startup rejects it.
- `emits` lists an event that is never emitted; the flow graph shows a possible
  edge.
- The handler calls `$transaction` and opens a second transaction.
- A post-commit listener assumes it shares the command transaction.
- A new command uses `mode: "none"` even though the application is all required.
