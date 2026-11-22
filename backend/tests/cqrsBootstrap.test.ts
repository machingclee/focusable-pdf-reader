import { describe, expect, test } from "bun:test";
import {
  Actor,
  BoundedContext,
  Command,
  CommandHandler,
  DomainEvent,
  EventListener,
  Invariant,
  Policy,
  createCqrs,
  type AuditBatch,
  type AuditEventRepository,
  type CommandContext,
  type ICommandHandler,
} from "express-prisma-cqrs";

class RecordingAuditRepository implements AuditEventRepository {
  readonly batches: AuditBatch[] = [];

  async save(batch: AuditBatch): Promise<void> {
    this.batches.push(batch);
  }
}

@Actor("Reader")
@BoundedContext("Bootstrap")
class CreateThing extends Command<string> {
  constructor(readonly value: string) {
    super();
  }
}

@BoundedContext("Bootstrap")
class ThingCreatedEvent extends DomainEvent {
  constructor(readonly value: string) {
    super();
  }
}

@CommandHandler(CreateThing, { emits: [ThingCreatedEvent] })
class CreateThingHandler implements ICommandHandler<CreateThing, string> {
  async handle(command: CreateThing, context: CommandContext): Promise<string> {
    context.events.add(new ThingCreatedEvent(command.value));
    return command.value;
  }
}

@BoundedContext("Bootstrap")
@Policy()
class ThingPolicy {
  @EventListener(ThingCreatedEvent, { sends: [CreateThing] })
  @Invariant("a created thing can be recorded again by an explicit command")
  onCreated(): void {
    // The flow metadata is the subject of this test; the policy is intentionally
    // inert so the command does not recurse.
  }
}

describe("createCqrs", () => {
  test("builds a module without an audit database", async () => {
    const module = createCqrs({ components: [CreateThingHandler, ThingPolicy] });

    await expect(module.commandBus.send(new CreateThing("no-audit"))).resolves.toBe("no-audit");
    expect(module.flow().commands.map((command) => command.name)).toContain("CreateThing");
  });

  test("builds a module from components and an audit repository alone", async () => {
    const audit = new RecordingAuditRepository();
    const module = createCqrs({
      components: [CreateThingHandler, ThingPolicy],
      auditEventRepository: audit,
    });

    await expect(module.commandBus.send(new CreateThing("hello"))).resolves.toBe("hello");

    expect(audit.batches).toHaveLength(1);
    expect(audit.batches[0]?.committed).toBe(true);
    expect(audit.batches[0]?.records.length).toBeGreaterThan(0);

    const flow = module.flow();
    expect(flow.commands.map((command) => command.name)).toContain("CreateThing");
    expect(flow.events.map((event) => event.name)).toContain("ThingCreatedEvent");
    expect(flow.policies.map((policy) => policy.name)).toContain("ThingPolicy");
    expect(flow.invariants).toHaveLength(1);
  });
});
