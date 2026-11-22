import {
  EXTERNAL_CONTEXT,
  WILDCARD_EVENT,
  type CommandModel,
  type ContextModel,
  type DtoMap,
  type EventModel,
  type FieldMap,
  type FlowGraph,
  type PolicyModel,
  type QueryModel,
  type RichFlowData,
  type RichPolicyFlow,
} from "./types";

/** A JSON problem the viewer can explain to the user instead of crashing. */
export class FlowJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowJsonError";
  }
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => asString(item)).filter((item): item is string => item !== undefined)
    : [];

const asRecordArray = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const asFieldMap = (value: unknown): FieldMap => (isRecord(value) ? value : {});

/** `name → fields` maps (`dtos`), used to open nested payload types one level. */
const asDtoMap = (value: unknown): DtoMap => {
  const out: DtoMap = {};
  if (!isRecord(value)) return out;
  for (const [name, fields] of Object.entries(value)) out[name] = asFieldMap(fields);
  return out;
};

/** Accept the raw body, `{ result: … }` and `{ data: … }` wrappers. */
function unwrap(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const keys = Object.keys(input);
  const wrapperKeys = ["result", "data", "body", "flow"];
  const onlyWrapper = keys.length <= 2 && keys.some((key) => wrapperKeys.includes(key));
  if (onlyWrapper && isRecord(input.result)) return input.result;
  if (onlyWrapper && isRecord(input.data)) return input.data;
  if (onlyWrapper && isRecord(input.flow)) return input.flow;
  return input;
}

/** Parse a JSON string and normalize it; every failure is a `FlowJsonError`. */
export function parseFlowJson(text: string): FlowGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new FlowJsonError(
      `That is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return normalizeFlow(parsed);
}

/**
 * Normalize either supported shape into `FlowGraph`.
 *
 * Shape detection: `commands[].from`/`to` (or an object-shaped `policies`) is
 * the rich Java-style payload; `commands[].emits` is the backend's
 * `GET /docs/commands` response.
 */
export function normalizeFlow(input: unknown): FlowGraph {
  const raw = unwrap(input);
  if (!isRecord(raw)) {
    throw new FlowJsonError('Expected a JSON object with a "commands" array.');
  }
  if (!Array.isArray(raw.commands)) {
    throw new FlowJsonError(
      'Missing "commands" array. Expected the body of GET /docs/commands, e.g. { "commands": [ … ] }.',
    );
  }

  const richCommands = raw.commands.some((entry) => {
    if (!isRecord(entry)) return false;
    return "from" in entry || "to" in entry;
  });
  const richPolicies = isRecord(raw.policies);
  const source = richCommands || richPolicies ? "command-flow" : "domain-flow";

  return source === "domain-flow" ? fromDomainFlow(raw) : fromRichFlow(raw);
}

// ── Shape 1: GET /docs/commands ──────────────────────────────────────────

function fromDomainFlow(raw: Json): FlowGraph {
  const commands: CommandModel[] = [];
  for (const entry of asRecordArray(raw.commands)) {
    const name = asString(entry.name);
    if (!name) continue;
    commands.push({
      name,
      context: asString(entry.context) ?? "Default",
      actors: asStringArray(entry.actors),
      handler: asString(entry.handler),
      transaction: asString(entry.transaction),
      emits: asStringArray(entry.emits),
      payload: asFieldMap(entry.payload),
    });
  }

  const queries: QueryModel[] = [];
  for (const entry of asRecordArray(raw.queries)) {
    const name = asString(entry.name);
    if (!name) continue;
    queries.push({
      name,
      context: asString(entry.context) ?? "Default",
      actors: asStringArray(entry.actors),
      handler: asString(entry.handler),
      payload: asFieldMap(entry.payload),
      resultName: asString(entry.resultName) ?? "",
      resultPayload: asFieldMap(entry.resultPayload),
    });
  }

  // Rules live on the listener method, keyed by the policy class name.
  const rulesByPolicy = new Map<string, string[]>();
  for (const entry of asRecordArray(raw.invariants)) {
    const component = asString(entry.component);
    if (!component) continue;
    const rules = asStringArray(entry.rules);
    if (rules.length === 0) continue;
    rulesByPolicy.set(component, [...(rulesByPolicy.get(component) ?? []), ...rules]);
  }

  const policies: PolicyModel[] = [];
  for (const entry of asRecordArray(raw.policies)) {
    const name = asString(entry.name);
    if (!name) continue;
    const listensTo = asStringArray(entry.listensTo);
    policies.push({
      name,
      listensTo,
      sends: asStringArray(entry.sends),
      rules: rulesByPolicy.get(name) ?? [],
      links: [],
      wildcard: listensTo.includes(WILDCARD_EVENT),
    });
  }

  // Declared events carry the context; events a handler emits but never
  // declared still belong to the graph, with their command's context.
  const eventContexts = new Map<string, string>();
  const eventPayloads = new Map<string, FieldMap>();
  for (const entry of asRecordArray(raw.events)) {
    const name = asString(entry.name);
    if (!name) continue;
    eventContexts.set(name, asString(entry.context) ?? "");
    eventPayloads.set(name, asFieldMap(entry.payload));
  }
  for (const command of commands) {
    for (const eventName of command.emits) {
      if (!eventContexts.has(eventName)) eventContexts.set(eventName, command.context);
    }
  }

  return buildGraph({
    source: "domain-flow",
    title: asString(raw.title),
    commands,
    queries,
    policies,
    eventNames: [...eventContexts.keys()],
    declaredEventContext: (name) => eventContexts.get(name),
    contextFallback: (name) =>
      commands.find((command) => command.emits.includes(name))?.context ?? EXTERNAL_CONTEXT,
    eventPayload: (name) => eventPayloads.get(name) ?? {},
    dtos: asDtoMap(raw.dtos),
    queryDtos: asDtoMap(raw.dtos),
  });
}

// ── Shape 2: Java-style payload flow ─────────────────────────────────────

function payloadOf(value: unknown, key: "command" | "event" | "query"): {
  name: string;
  payload: FieldMap;
} {
  if (typeof value === "string") return { name: value.trim(), payload: {} };
  if (!isRecord(value)) return { name: "", payload: {} };
  return {
    name: asString(value[key]) ?? "",
    payload: asFieldMap(value.payload),
  };
}

function normalizePolicyFlow(entry: Json): RichPolicyFlow {
  return {
    fromEvent: asString(entry.fromEvent) ?? null,
    toCommand: asString(entry.toCommand) ?? null,
    invariant: asString(entry.invariant) ?? "",
    fromEventContext: asString(entry.fromEventContext) ?? null,
  };
}

function fromRichFlow(raw: Json): FlowGraph {
  const data = raw as RichFlowData;
  const commands: CommandModel[] = [];
  const eventPayloads = new Map<string, FieldMap>();

  for (const entry of asRecordArray(data.commands)) {
    const from = payloadOf(entry.from, "command");
    if (!from.name) continue;
    const targets = asRecordArray(entry.to).map((item) => payloadOf(item, "event"));
    for (const target of targets) {
      if (target.name && !eventPayloads.has(target.name)) {
        eventPayloads.set(target.name, target.payload);
      }
    }
    commands.push({
      name: from.name,
      context: asString(entry.context) ?? "Default",
      actors: asStringArray(entry.roles).length > 0
        ? asStringArray(entry.roles)
        : asStringArray(entry.actors),
      emits: targets.map((target) => target.name).filter(Boolean),
      payload: from.payload,
      summary: asString(entry.summary),
      httpMethod: asString(entry.httpMethod),
      path: asString(entry.path),
    });
  }

  const queries: QueryModel[] = [];
  for (const entry of asRecordArray(data.queries)) {
    const from = payloadOf(entry.from, "query");
    if (!from.name) continue;
    const result = payloadOf(entry.result, "query");
    queries.push({
      name: from.name,
      context: asString(entry.context) ?? "Default",
      actors: asStringArray(entry.roles).length > 0
        ? asStringArray(entry.roles)
        : asStringArray(entry.actors),
      payload: from.payload,
      resultName: result.name,
      resultPayload: result.payload,
      summary: asString(entry.summary),
      httpMethod: asString(entry.httpMethod),
      path: asString(entry.path),
    });
  }

  // `policies` is either `{ name: { flows: [...] } }` or a flat flow array.
  const policyGroups = new Map<string, RichPolicyFlow[]>();
  if (isRecord(data.policies)) {
    for (const [name, group] of Object.entries(data.policies)) {
      const flows = isRecord(group) ? asRecordArray(group.flows).map(normalizePolicyFlow) : [];
      policyGroups.set(name, flows);
    }
  } else if (Array.isArray(data.policies)) {
    for (const flow of asRecordArray(data.policies)) {
      const name = asString(flow.policy) ?? asString(flow.name) ?? "Policy";
      const list = policyGroups.get(name) ?? [];
      list.push(normalizePolicyFlow(flow));
      policyGroups.set(name, list);
    }
  }

  const policies: PolicyModel[] = [];
  for (const [name, flows] of policyGroups) {
    const listensTo = [...new Set(flows.map((flow) => flow.fromEvent).filter((event): event is string => !!event))];
    const sends = [...new Set(flows.map((flow) => flow.toCommand).filter((command): command is string => !!command))];
    policies.push({
      name,
      listensTo,
      sends,
      // Each flow's invariant is the reason that routing exists.
      rules: flows
        .map((flow) => flow.invariant)
        .filter((rule): rule is string => !!rule && rule.length > 0),
      links: flows,
      wildcard: listensTo.includes(WILDCARD_EVENT),
    });
  }

  const declaredEvents = new Map<string, string>();
  for (const entry of asRecordArray(data.events)) {
    const name = asString(entry.name);
    if (!name) continue;
    declaredEvents.set(name, asString(entry.context) ?? "");
  }
  for (const flow of policies.flatMap((policy) => policy.links)) {
    if (!flow.fromEvent) continue;
    if (flow.fromEventContext && !declaredEvents.get(flow.fromEvent)) {
      declaredEvents.set(flow.fromEvent, flow.fromEventContext);
    }
    if (!eventPayloads.has(flow.fromEvent)) eventPayloads.set(flow.fromEvent, {});
  }

  const eventNames = new Set<string>([
    ...eventPayloads.keys(),
    ...declaredEvents.keys(),
    ...policies.flatMap((policy) => policy.links.map((link) => link.fromEvent ?? "")),
  ]);
  eventNames.delete("");

  return buildGraph({
    source: "command-flow",
    title: asString(raw.title),
    commands,
    queries,
    policies,
    eventNames: [...eventNames],
    declaredEventContext: (name) => declaredEvents.get(name),
    contextFallback: () => EXTERNAL_CONTEXT,
    eventPayload: (name) => eventPayloads.get(name) ?? {},
    dtos: data.dtos ?? {},
    queryDtos: data.queryDtos ?? data.dtos ?? {},
  });
}

// ── Shared graph assembly ────────────────────────────────────────────────

interface BuildGraphInput {
  source: FlowGraph["source"];
  title?: string;
  commands: CommandModel[];
  queries: QueryModel[];
  policies: PolicyModel[];
  eventNames: string[];
  declaredEventContext: (name: string) => string | undefined;
  contextFallback: (name: string) => string;
  eventPayload?: (name: string) => FieldMap;
  dtos?: DtoMap;
  queryDtos?: DtoMap;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

const compareStrings = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

function buildGraph(input: BuildGraphInput): FlowGraph {
  const listenersOf = (eventName: string): string[] =>
    input.policies
      .filter((policy) => policy.listensTo.includes(eventName) || policy.wildcard)
      .map((policy) => policy.name);

  const events: EventModel[] = input.eventNames.sort(compareStrings).map((name) => {
    const emittedBy = input.commands
      .filter((command) => command.emits.includes(name))
      .map((command) => command.name);
    const declaredContext = input.declaredEventContext(name);
    const context =
      (declaredContext && declaredContext.length > 0 ? declaredContext : undefined) ??
      (emittedBy.length > 0
        ? input.commands.find((command) => command.name === emittedBy[0])?.context ?? "Default"
        : input.contextFallback(name));
    return {
      name,
      context,
      emittedBy,
      listenedBy: listenersOf(name),
      payload: input.eventPayload ? input.eventPayload(name) : {},
      external: emittedBy.length === 0,
    };
  });

  const contexts = buildContexts({
    commands: input.commands,
    queries: input.queries,
    events,
    policies: input.policies,
  });

  const roots = contexts.filter((context) => context.depth === 0);
  const title =
    input.title ??
    `${roots.map((context) => context.label).join(" + ") || "Flow"} event storming`;

  return {
    source: input.source,
    title,
    commands: [...input.commands].sort(byName),
    events,
    queries: [...input.queries].sort(byName),
    policies: [...input.policies].sort(byName),
    contexts,
    dtos: input.dtos ?? {},
    queryDtos: input.queryDtos ?? input.dtos ?? {},
    externalContexts: contexts
      .filter((context) => context.commands.length === 0 && context.queries.length === 0)
      .filter((context) => context.events.some((event) => event.external))
      .map((context) => context.name),
  };
}

interface BuildContextsInput {
  commands: CommandModel[];
  queries: QueryModel[];
  events: EventModel[];
  policies: PolicyModel[];
}

/**
 * Build the context tree from dotted names (`Booking.Timeslot` creates both
 * `Booking` and `Booking.Timeslot`, the second nested inside the first).
 *
 * Policies are attached to the context that owns most of the events they
 * listen to, so a policy that routes across contexts sits with its busiest
 * input.
 */
function buildContexts(input: BuildContextsInput): ContextModel[] {
  const names = new Set<string>();
  const addWithParents = (fullName: string): void => {
    const parts = fullName.split(".").filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      names.add(parts.slice(0, index).join("."));
    }
  };

  input.commands.forEach((command) => addWithParents(command.context));
  input.queries.forEach((query) => addWithParents(query.context));
  input.events.forEach((event) => addWithParents(event.context));
  if (names.size === 0) names.add("Default");

  const nodes = new Map<string, ContextModel>();
  for (const name of [...names].sort((a, b) => {
    const depthDelta = a.split(".").length - b.split(".").length;
    return depthDelta !== 0 ? depthDelta : a.localeCompare(b);
  })) {
    const parts = name.split(".");
    const parent = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
    nodes.set(name, {
      name,
      label: parts[parts.length - 1],
      depth: parts.length - 1,
      parent,
      children: [],
      commands: [],
      queries: [],
      events: [],
      policies: [],
    });
  }
  for (const node of nodes.values()) {
    if (node.parent) nodes.get(node.parent)?.children.push(node.name);
  }

  input.commands.forEach((command) => nodes.get(command.context)?.commands.push(command));
  input.queries.forEach((query) => nodes.get(query.context)?.queries.push(query));
  input.events.forEach((event) => nodes.get(event.context)?.events.push(event));
  for (const node of nodes.values()) {
    node.commands.sort(byName);
    node.queries.sort(byName);
    node.events.sort(byName);
  }

  // A policy belongs where most of its inputs are produced.
  for (const policy of input.policies) {
    const tally = new Map<string, number>();
    if (policy.wildcard) {
      input.events.forEach((event) => {
        tally.set(event.context, (tally.get(event.context) ?? 0) + 1);
      });
    } else {
      for (const eventName of policy.listensTo) {
        const event = input.events.find((candidate) => candidate.name === eventName);
        if (!event) continue;
        tally.set(event.context, (tally.get(event.context) ?? 0) + 1);
      }
    }
    const home = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const node = home ? nodes.get(home) : undefined;
    if (node) node.policies.push(policy);
  }
  for (const node of nodes.values()) node.policies.sort(byName);

  return [...nodes.values()].sort((a, b) => {
    const depthDelta = a.depth - b.depth;
    return depthDelta !== 0 ? depthDelta : a.name.localeCompare(b.name);
  });
}
