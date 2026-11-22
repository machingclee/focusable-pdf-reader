/**
 * Behaviour of the in-process domain pipeline: decorators, DI, command/query
 * routing, nested commands, event timing and the write-behind audit batch.
 *
 * These tests use a fake TransactionRunner and MemoryAuditWriter, so they do
 * not need a database and cannot be affected by the application's Prisma setup.
 */
import { describe, expect, test } from "bun:test";
import {
  Actor,
  ApplicationEventPublisher,
  AUDIT_WRITER,
  BoundedContext,
  Command,
  CommandBus,
  CommandHandler,
  Container,
  DomainEvent,
  EventListener,
  Invariant,
  MemoryAuditWriter,
  Payload,
  Policy,
  Query,
  QueryBus,
  QueryHandler,
  Service,
  Transactional,
  TRANSACTION_RUNNER,
  createCqrsModule,
  type AuditWriter,
  type CommandContext,
  type Constructor,
  type ICommandHandler,
  type IQueryHandler,
  type TransactionRunner,
} from "@machingclee/express-cqrs";

class TestRunner implements TransactionRunner {
  runs = 0;
  active = 0;
  readonly order: string[] = [];

  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.runs += 1;
    this.active += 1;
    this.order.push("tx:start");
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.order.push("tx:end");
    }
  }

  isActive(): boolean {
    return this.active > 0;
  }
}

function buildModule(options: {
  components: Constructor[];
  runner?: TestRunner;
  writer?: AuditWriter;
  strictDomainTypes?: boolean;
}) {
  const container = new Container();
  const runner = options.runner ?? new TestRunner();
  const writer = options.writer ?? new MemoryAuditWriter();
  container.registerValue(TRANSACTION_RUNNER, runner);
  container.registerValue(AUDIT_WRITER, writer);
  const module = createCqrsModule({
    container,
    components: options.components,
    strictDomainTypes: options.strictDomainTypes ?? false,
  });
  return { container, module, runner, writer };
}

function silenceConsole() {
  const original = console.error;
  console.error = () => { };
  return () => {
    console.error = original;
  };
}

describe("decorators and metadata", () => {
  test("a command handler is routed and the command/query flow is built from decorators", async () => {
    @BoundedContext("Notes")
    @Actor("Reader")
    @Payload({ text: "string" })
    class CreateNote extends Command<string> {
      constructor(readonly text: string) {
        super();
      }
    }

    @BoundedContext("Notes")
    @Payload({ id: "number" }, { NoteAudit: { actor: "string", at: "number" } })
    class NoteCreatedEvent extends DomainEvent {
      constructor(readonly id: number) {
        super();
      }
    }

    @BoundedContext("Notes")
    @Actor("Reader")
    class GetNote extends Query<string> { }

    @CommandHandler(CreateNote, { emits: [NoteCreatedEvent] })
    class CreateNoteHandler implements ICommandHandler<CreateNote, string> {
      handle(command: CreateNote): string {
        return command.text.trim();
      }
    }

    @Policy()
    class NotePolicy {
      @EventListener(NoteCreatedEvent)
      @Invariant("a created note must be observable to later readers")
      record(): void { }
    }

    @QueryHandler(GetNote)
    class GetNoteHandler implements IQueryHandler<GetNote, string> {
      handle(): string {
        return "note";
      }
    }

    const { module } = buildModule({
      components: [CreateNoteHandler, GetNoteHandler, NotePolicy],
      strictDomainTypes: true,
    });

    expect(await module.commandBus.send(new CreateNote(" hello "))).toBe("hello");
    expect(await module.queryBus.send(new GetNote())).toBe("note");

    const flow = module.flow();
    expect(flow.commands).toEqual([
      {
        name: "CreateNote",
        handler: "CreateNoteHandler",
        context: "Notes",
        actors: ["Reader"],
        transaction: "required",
        emits: ["NoteCreatedEvent"],
        payload: { text: "string" },
      },
    ]);
    expect(flow.queries).toEqual([
      {
        name: "GetNote",
        handler: "GetNoteHandler",
        context: "Notes",
        actors: ["Reader"],
        payload: {},
      },
    ]);
    expect(flow.events).toEqual([
      { name: "NoteCreatedEvent", context: "Notes", payload: { id: "number" } },
    ]);
    // Nested shapes declared next to a payload are gathered for the diagram.
    expect(flow.dtos).toEqual({ NoteAudit: { actor: "string", at: "number" } });
    expect(flow.invariants).toEqual([
      {
        component: "NotePolicy",
        method: "record",
        rules: ["a created note must be observable to later readers"],
      },
    ]);
  });

  test("@Invariant is rejected outside a policy event listener", () => {
    @BoundedContext("Notes")
    @Actor("Reader")
    class CreateNote extends Command<void> { }

    @CommandHandler(CreateNote)
    class CreateNoteHandler implements ICommandHandler<CreateNote> {
      @Invariant("a note must have text")
      handle(): void { }
    }

    expect(() =>
      buildModule({ components: [CreateNoteHandler], strictDomainTypes: true }),
    ).toThrow(/@Invariant is only allowed on an @EventListener method of a @Policy/);
  });

  test("strict mode rejects a command without a domain annotation", () => {
    class UnnamedCommand extends Command<void> { }

    @CommandHandler(UnnamedCommand)
    class UnnamedHandler implements ICommandHandler<UnnamedCommand> {
      handle(): void { }
    }

    expect(() => buildModule({ components: [UnnamedHandler], strictDomainTypes: true })).toThrow(
      /UnnamedCommand needs @Actor/,
    );
  });

  test("strict mode rejects an event that is not decorated", () => {
    @Actor("Reader")
    @BoundedContext("Notes")
    class SomeCommand extends Command<void> { }

    class UndecoratedEvent extends DomainEvent { }

    @CommandHandler(SomeCommand, { emits: [UndecoratedEvent] })
    class SomeHandler implements ICommandHandler<SomeCommand> {
      handle(): void { }
    }

    expect(() => buildModule({ components: [SomeHandler], strictDomainTypes: true })).toThrow(
      /UndecoratedEvent needs @BoundedContext/,
    );
  });

  test("duplicate handlers and listeners on a non-policy are startup errors", () => {
    @Actor("Reader")
    @BoundedContext("Notes")
    class DuplicateCommand extends Command<void> { }

    @CommandHandler(DuplicateCommand)
    class FirstHandler implements ICommandHandler<DuplicateCommand> {
      handle(): void { }
    }

    @CommandHandler(DuplicateCommand)
    class SecondHandler implements ICommandHandler<DuplicateCommand> {
      handle(): void { }
    }

    expect(() => buildModule({ components: [FirstHandler, SecondHandler] })).toThrow(
      /Multiple handlers for command DuplicateCommand/,
    );

    class SomeEvent extends DomainEvent { }

    @Service()
    class NotAPolicy {
      @EventListener(SomeEvent)
      onEvent(): void { }
    }

    expect(() => buildModule({ components: [NotAPolicy] })).toThrow(/no @Policy\(\) decorator/);
  });
});

describe("dependency injection", () => {
  test("@Service components are injected through explicit tokens", async () => {
    @Service()
    class GreetingService {
      greet(name: string): string {
        return `hello ${name}`;
      }
    }

    @Actor("Reader")
    @BoundedContext("Notes")
    class SayHello extends Command<string> {
      constructor(readonly name: string) {
        super();
      }
    }

    @CommandHandler(SayHello, { inject: [GreetingService] })
    class SayHelloHandler implements ICommandHandler<SayHello, string> {
      constructor(private readonly greetings: GreetingService) { }

      handle(command: SayHello): string {
        return this.greetings.greet(command.name);
      }
    }

    const { module } = buildModule({ components: [SayHelloHandler, GreetingService] });
    expect(await module.commandBus.send(new SayHello("reader"))).toBe("hello reader");
  });

  test("missing providers and cycles fail with a useful message", () => {
    const container = new Container();
    expect(() => container.resolve(class Unknown { })).toThrow(/no provider registered/);

    class Left {
      constructor(readonly right: Right) { }
    }
    class Right {
      constructor(readonly left: Left) { }
    }
    container.registerClass(Left, Left, [Right]);
    container.registerClass(Right, Right, [Left]);
    expect(() => container.resolve(Left)).toThrow(/circular dependency: Left -> Right -> Left/);
  });
});

describe("command bus", () => {
  test("a nested command reuses the ambient transaction and post-commit events wait for it", async () => {
    const runner = new TestRunner();
    const order = runner.order;

    @BoundedContext("Test")
    class InnerDoneEvent extends DomainEvent { }

    @BoundedContext("Test")
    class ImmediateEvent extends DomainEvent { }

    @Actor("Reader")
    @BoundedContext("Test")
    class OuterCommand extends Command<void> { }

    @Actor("Reader")
    @BoundedContext("Test")
    class InnerCommand extends Command<void> { }

    @CommandHandler(OuterCommand, { emits: [ImmediateEvent] })
    class OuterHandler implements ICommandHandler<OuterCommand> {
      handle(_command: OuterCommand, context: CommandContext): void {
        order.push("outer");
        context.events.add(new ImmediateEvent());
        context.events.addTransactional(new InnerDoneEvent());
      }
    }

    @CommandHandler(InnerCommand, { emits: [InnerDoneEvent] })
    class InnerHandler implements ICommandHandler<InnerCommand> {
      handle(): void {
        order.push("inner");
      }
    }

    @Policy({ inject: [CommandBus] })
    class InnerPolicy {
      constructor(private readonly commandBus: CommandBus) { }

      @EventListener(ImmediateEvent, { sends: [InnerCommand] })
      async onImmediate(): Promise<void> {
        await this.commandBus.send(new InnerCommand());
      }
    }

    @Policy()
    class AfterCommitPolicy {
      @EventListener(InnerDoneEvent)
      onDone(): void {
        order.push("post-commit");
      }
    }

    const { module } = buildModule({
      components: [OuterHandler, InnerHandler, InnerPolicy, AfterCommitPolicy],
      runner,
    });

    await module.commandBus.send(new OuterCommand());

    expect(order).toEqual(["tx:start", "outer", "inner", "tx:end", "post-commit"]);
    expect(runner.runs).toBe(1);
  });

  test("a top-level failure stamps the audit batch and does not dispatch post-commit events", async () => {
    let postCommitRan = false;

    @Actor("Reader")
    @BoundedContext("Test")
    class FailingCommand extends Command<void> { }

    @BoundedContext("Test")
    class NeverRunsEvent extends DomainEvent { }

    @CommandHandler(FailingCommand, { emits: [NeverRunsEvent] })
    class FailingHandler implements ICommandHandler<FailingCommand> {
      handle(_command: FailingCommand, context: CommandContext): void {
        context.events.addTransactional(new NeverRunsEvent());
        throw new Error("write refused");
      }
    }

    @Policy()
    class NeverRunsPolicy {
      @EventListener(NeverRunsEvent)
      onNever(): void {
        postCommitRan = true;
      }
    }

    const writer = new MemoryAuditWriter();
    const { module } = buildModule({ components: [FailingHandler, NeverRunsPolicy], writer });

    await expect(module.commandBus.send(new FailingCommand())).rejects.toThrow("write refused");
    expect(postCommitRan).toBe(false);

    const batch = writer.batches.at(-1);
    expect(batch?.committed).toBe(false);
    expect(batch?.records.map((record) => record.type)).toEqual(["FailingCommand", "NeverRunsEvent"]);
    expect(batch?.records.every((record) => record.success === false)).toBe(true);
    const commandRecord = batch?.records[0];
    expect(commandRecord?.type).toBe("FailingCommand");
    expect(commandRecord?.failureReason).toContain("write refused");
  });

  test("a nested command that fails and is caught only marks its own audit slice", async () => {
    @Actor("Reader")
    @BoundedContext("Test")
    class OuterCommand extends Command<string> { }

    @Actor("Reader")
    @BoundedContext("Test")
    class RejectedCommand extends Command<void> { }

    @BoundedContext("Test")
    class OuterEvent extends DomainEvent { }

    @CommandHandler(OuterCommand, { emits: [OuterEvent] })
    class OuterHandler implements ICommandHandler<OuterCommand, string> {
      handle(_command: OuterCommand, context: CommandContext): string {
        context.events.add(new OuterEvent());
        return "outer done";
      }
    }

    @CommandHandler(RejectedCommand)
    class RejectedHandler implements ICommandHandler<RejectedCommand> {
      handle(): void {
        throw new Error("inner refused");
      }
    }

    @Policy({ inject: [CommandBus] })
    class CatchPolicy {
      constructor(private readonly commandBus: CommandBus) { }

      @EventListener(OuterEvent, { sends: [RejectedCommand] })
      async onOuter(): Promise<void> {
        try {
          await this.commandBus.send(new RejectedCommand());
        } catch {
          // the outer command survives a nested command it decided to ignore
        }
      }
    }

    const writer = new MemoryAuditWriter();
    const { module } = buildModule({ components: [OuterHandler, RejectedHandler, CatchPolicy], writer });

    expect(await module.commandBus.send(new OuterCommand())).toBe("outer done");

    const batch = writer.batches.at(-1);
    expect(batch?.committed).toBe(true);
    expect(batch?.records.map((record) => record.type)).toEqual([
      "OuterCommand",
      "OuterEvent",
      "RejectedCommand",
    ]);
    expect(batch?.records.map((record) => record.success)).toEqual([true, true, false]);
    expect(batch?.records[2]?.failureReason).toContain("inner refused");
  });

  test("audit failures and post-commit listener failures never change the command result", async () => {
    const restore = silenceConsole();
    try {
      @Actor("Reader")
      @BoundedContext("Test")
      class SomeCommand extends Command<string> { }

      @BoundedContext("Test")
      class PostEvent extends DomainEvent { }

      @CommandHandler(SomeCommand, { afterCommit: [PostEvent] })
      class SomeHandler implements ICommandHandler<SomeCommand, string> {
        handle(_command: SomeCommand, context: CommandContext): string {
          context.events.addTransactional(new PostEvent());
          return "committed";
        }
      }

      @Policy()
      class BrokenPolicy {
        @EventListener(PostEvent)
        onPost(): void {
          throw new Error("side effect failed");
        }
      }

      const writer: AuditWriter = {
        async write(): Promise<void> {
          throw new Error("audit store down");
        },
      };

      const { module } = buildModule({ components: [SomeHandler, BrokenPolicy], writer });
      expect(await module.commandBus.send(new SomeCommand())).toBe("committed");
    } finally {
      restore();
    }
  });

  test("a post-commit listener failure is audited without failing the command", async () => {
    const restore = silenceConsole();
    try {
      @Actor("Reader")
      @BoundedContext("Test")
      class SomeCommand extends Command<string> { }

      @BoundedContext("Test")
      class PostEvent extends DomainEvent { }

      @CommandHandler(SomeCommand, { emits: [PostEvent] })
      class SomeHandler implements ICommandHandler<SomeCommand, string> {
        handle(_command: SomeCommand, context: CommandContext): string {
          context.events.addTransactional(new PostEvent());
          return "committed";
        }
      }

      @Policy()
      class BrokenPolicy {
        @EventListener(PostEvent)
        onPost(): void {
          throw new Error("side effect failed");
        }
      }

      const writer = new MemoryAuditWriter();
      const { module } = buildModule({ components: [SomeHandler, BrokenPolicy], writer });

      expect(await module.commandBus.send(new SomeCommand())).toBe("committed");

      const batch = writer.batches.at(-1);
      expect(batch?.committed).toBe(true);
      const eventRecord = batch?.records.find((record) => record.type === "PostEvent");
      expect(eventRecord?.success).toBe(false);
      expect(eventRecord?.failureReason).toContain("side effect failed");
    } finally {
      restore();
    }
  });

  test("mode none does not open a transaction, and events discovered at runtime reach the flow", async () => {
    @Actor("Reader")
    @BoundedContext("Test")
    class ImporterCommand extends Command<void> { }

    @BoundedContext("Test")
    class LateEvent extends DomainEvent { }

    @Transactional({ mode: "none" })
    @CommandHandler(ImporterCommand)
    class ImporterHandler implements ICommandHandler<ImporterCommand> {
      handle(_command: ImporterCommand, context: CommandContext): void {
        context.events.add(new LateEvent());
      }
    }

    const runner = new TestRunner();
    const { module } = buildModule({ components: [ImporterHandler], runner });

    await module.commandBus.send(new ImporterCommand());
    expect(runner.runs).toBe(0);
    expect(module.flow().events).toContainEqual({
      name: "LateEvent",
      context: "Test",
      payload: {},
    });
  });

  test("@Policy({ excludeFromFlow }) keeps a wildcard listener out of the graph", async () => {
    @BoundedContext("Notes")
    @Actor("Reader")
    @Payload({ text: "string" })
    class WriteNote extends Command<void> {
      constructor(readonly text: string) {
        super();
      }
    }

    @BoundedContext("Notes")
    @Payload({ noteId: "number" })
    class NoteWrittenEvent extends DomainEvent {
      constructor(readonly noteId: number) {
        super();
      }
    }

    @CommandHandler(WriteNote, { emits: [NoteWrittenEvent] })
    class WriteNoteHandler implements ICommandHandler<WriteNote> {
      handle(_command: WriteNote, context: CommandContext): void {
        context.events.add(new NoteWrittenEvent(1));
      }
    }

    let seen = 0;

    @Policy({ excludeFromFlow: true })
    class DevEventLog {
      @EventListener(DomainEvent)
      log(): void {
        seen += 1;
      }
    }

    const { module } = buildModule({ components: [WriteNoteHandler, DevEventLog] });
    await module.commandBus.send(new WriteNote(" hi "));

    // It still runs…
    expect(seen).toBe(1);
    // …but it is not part of the graph, so no wildcard policy and no invariants.
    const flow = module.flow();
    expect(flow.policies).toEqual([]);
    expect(flow.invariants).toEqual([]);
    expect(flow.events).toEqual([
      { name: "NoteWrittenEvent", context: "Notes", payload: { noteId: "number" } },
    ]);
  });

  test("the flow reports queries and policies even without a command", async () => {
    @Actor("Reader")
    @BoundedContext("Preferences")
    class GetPreferences extends Query<string> { }

    @QueryHandler(GetPreferences)
    class GetPreferencesHandler implements IQueryHandler<GetPreferences, string> {
      handle(): string {
        return "{}";
      }
    }

    @BoundedContext("Test")
    class SomeEvent extends DomainEvent { }

    @Policy()
    class SomePolicy {
      @EventListener(SomeEvent)
      onEvent(): void { }
    }

    const { module } = buildModule({ components: [GetPreferencesHandler, SomePolicy] });
    const flow = module.flow();
    expect(flow.queries[0]?.name).toBe("GetPreferences");
    expect(flow.policies).toEqual([
      { name: "SomePolicy", listensTo: ["SomeEvent"], sends: [] },
    ]);
  });
});

describe("publisher and buses", () => {
  test("the publisher matches superclasses and sequential order", async () => {
    const seen: string[] = [];
    const publisher = new ApplicationEventPublisher();

    @BoundedContext("Test")
    class FirstEvent extends DomainEvent { }
    @BoundedContext("Test")
    class SecondEvent extends FirstEvent { }

    publisher.subscribe(DomainEvent, () => {
      seen.push("domain");
    });
    publisher.subscribe(FirstEvent, (event) => {
      seen.push(event instanceof SecondEvent ? "second" : "first");
    });

    await publisher.publish(new SecondEvent());
    expect(seen).toEqual(["domain", "second"]);
  });

  test("missing handlers fail with the registered names", async () => {
    @Actor("Reader")
    @BoundedContext("Test")
    class UnknownCommand extends Command<void> { }

    const { module } = buildModule({ components: [] });
    await expect(module.commandBus.send(new UnknownCommand())).rejects.toThrow(
      /No handler registered for command UnknownCommand/,
    );
  });

  test("the buses and publisher are resolvable from the container", () => {
    const { container, module } = buildModule({ components: [] });
    expect(container.resolve(CommandBus)).toBe(module.commandBus);
    expect(container.resolve(QueryBus)).toBe(module.queryBus);
    expect(container.resolve(ApplicationEventPublisher)).toBe(module.events);
  });
});
