/**
 * The two JSON shapes this viewer understands, plus the normalized graph the
 * layout engine draws.
 *
 * 1. `DomainFlow` — what `GET /docs/commands` returns from the Node backend in
 *    `../backend` (see `src/core/domain-util/flow.ts`). Built from decorators at
 *    boot: a handler declares `emits`, a policy declares `listensTo`/`sends`.
 *    Carries no payload schemas, but knows handlers and invariants.
 *
 * 2. `RichFlowData` — the shape the Java/`commandInvoker` prototype emits and
 *    the `echarge-event-storming-component` project renders: per-command
 *    payload schemas, per-event payload schemas, DTO maps and policy flows with
 *    business-rule text.
 *
 * Both are normalized into `FlowGraph`, so every component below the loader
 * works on one model.
 */

// ── Shape 1: DomainFlow (GET /docs/commands) ──────────────────────────────

export interface DomainFlowCommand {
  name: string;
  handler: string;
  context: string;
  actors: string[];
  transaction?: "required" | "none";
  emits: string[];
}

export interface DomainFlowQuery {
  name: string;
  handler: string;
  context: string;
  actors: string[];
}

export interface DomainFlowPolicy {
  name: string;
  listensTo: string[];
  sends: string[];
}

export interface DomainFlowEvent {
  name: string;
  context: string;
}

export interface DomainFlowInvariant {
  component: string;
  method: string;
  rules: string[];
}

export interface DomainFlow {
  title?: string;
  commands: DomainFlowCommand[];
  queries?: DomainFlowQuery[];
  policies?: DomainFlowPolicy[];
  events?: DomainFlowEvent[];
  invariants?: DomainFlowInvariant[];
}

// ── Shape 2: RichFlowData (Java prototype / echarge component) ────────────

/** Field name → type descriptor, e.g. `{ id: "number", lines: "Line.DTO[]" }`. */
export type FieldMap = Record<string, unknown>;

/** DTO name → fields, used to expand nested payload types one level at a time. */
export type DtoMap = Record<string, FieldMap>;

export interface CommandPayload {
  command: string;
  payload: FieldMap;
}

export interface EventPayload {
  event: string;
  payload: FieldMap;
}

export interface QueryPayload {
  query: string;
  payload: FieldMap;
}

export interface RichCommand {
  from: CommandPayload | string;
  to?: EventPayload[];
  context?: string;
  actors?: string[];
  roles?: string[];
  httpMethod?: string;
  path?: string;
  summary?: string;
  description?: string;
}

export interface RichQuery {
  from: QueryPayload | string;
  result?: QueryPayload | string;
  context?: string;
  actors?: string[];
  roles?: string[];
  httpMethod?: string;
  path?: string;
  summary?: string;
  description?: string;
}

export interface RichPolicyFlow {
  fromEvent: string | null;
  toCommand: string | null;
  invariant?: string | null;
  fromEventContext?: string | null;
}

export interface RichFlowData {
  title?: string;
  commands?: RichCommand[];
  queries?: RichQuery[];
  policies?: Record<string, { flows?: RichPolicyFlow[] }> | RichPolicyFlow[];
  dtos?: DtoMap;
  queryDtos?: DtoMap;
  events?: DomainFlowEvent[];
}

// ── Normalized model ─────────────────────────────────────────────────────

export type FlowSource = "domain-flow" | "command-flow";

/** The one event name that means "every event" (the `DomainEvent` base class). */
export const WILDCARD_EVENT = "DomainEvent";

/** Context used for events no command emits and that declare no context. */
export const EXTERNAL_CONTEXT = "External";

/** A rendered `field: type` line, with braces spread out for nested DTOs. */
export interface SchemaLine {
  fieldName: string;
  typeName: string;
  indent: number;
  /** Set when this line opens a nested DTO block. */
  openDto?: string;
  /** True for the `}` line that closes a nested DTO block. */
  closeBrace?: boolean;
  /** Render `[]` after the closing brace. */
  closeArray?: boolean;
}

export interface CommandModel {
  name: string;
  context: string;
  actors: string[];
  handler?: string;
  transaction?: string;
  emits: string[];
  payload: FieldMap;
  summary?: string;
  httpMethod?: string;
  path?: string;
}

export interface EventModel {
  name: string;
  context: string;
  /** Commands whose handler declares this event (empty for external events). */
  emittedBy: string[];
  /** Policies listening to it, including wildcard listeners. */
  listenedBy: string[];
  payload: FieldMap;
  /** True when no command emits it, so it arrives from outside the backend. */
  external: boolean;
}

export interface QueryModel {
  name: string;
  context: string;
  actors: string[];
  handler?: string;
  payload: FieldMap;
  resultName: string;
  resultPayload: FieldMap;
  summary?: string;
  httpMethod?: string;
  path?: string;
}

export interface PolicyModel {
  name: string;
  /** Events it subscribes to; `WILDCARD_EVENT` means "all events". */
  listensTo: string[];
  /** Commands it dispatches. */
  sends: string[];
  /** Business rules from `@Invariant(...)`, one bullet each. */
  rules: string[];
  /** Event → command routing declared by the Java-style payload. */
  links: RichPolicyFlow[];
  /** True when it subscribes to `DomainEvent`, i.e. to every event. */
  wildcard: boolean;
}

export interface ContextModel {
  /** Dotted full name, e.g. `Booking.Timeslot`. */
  name: string;
  /** Last segment, used as the band label. */
  label: string;
  /** 0 for a top-level context. */
  depth: number;
  parent: string | null;
  children: string[];
  commands: CommandModel[];
  queries: QueryModel[];
  events: EventModel[];
  policies: PolicyModel[];
}

export interface FlowGraph {
  source: FlowSource;
  title: string;
  commands: CommandModel[];
  events: EventModel[];
  queries: QueryModel[];
  policies: PolicyModel[];
  contexts: ContextModel[];
  dtos: DtoMap;
  queryDtos: DtoMap;
  /** Context names that only hold external events. */
  externalContexts: string[];
}
