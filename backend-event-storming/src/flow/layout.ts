import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import { flattenSchema } from "./schema";
import {
  ACTOR_EDGE_COLOR,
  ACTOR_NODE_WIDTH_PX,
  ACTOR_STYLE,
  ACTOR_X,
  COMMAND_BLOCK_GAP,
  COMMAND_STYLE,
  COMMAND_X,
  CONTEXT_GAP,
  EVENT_STACK_GAP,
  EVENT_STYLE,
  EVENT_X,
  FLOW_EDGE_COLOR,
  GROUP_PADDING,
  GROUP_TOP_PADDING,
  NODE_WIDTH_PX,
  POLICY_EDGE_COLOR,
  POLICY_NODE_WIDTH,
  POLICY_X,
  RESULT_STYLE,
  VERTICAL_SPACING,
} from "./theme";
import type {
  CommandModel,
  DtoMap,
  EventModel,
  FieldMap,
  FlowGraph,
  PolicyModel,
  QueryModel,
} from "./types";

/**
 * Geometry and node styling of `echarge-event-storming-component`, applied to
 * this backend's graph.
 *
 * The reference puts every card inside a bounded-context *group node* and gives
 * it `parentId`, so dragging the group badge moves the whole context and
 * dragging a card moves just that card. That structure is reproduced here:
 * groups are emitted before their children (React Flow requires it), positions
 * are relative to the parent, and every node is draggable.
 */

export type LayoutTab = "commands" | "queries";

export type CardKind = "actor" | "command" | "event" | "policy" | "query" | "result";

/** What the inspector shows; parsed back from a node id. */
export interface Selection {
  kind: CardKind;
  name: string;
}

export interface LabelNodeData extends Record<string, unknown> {
  label: string;
  summary?: string;
  httpMethod?: string;
  path?: string;
  /** `"person"` draws the actor glyph and left-aligns the label. */
  icon?: string;
  payload?: FieldMap;
  dtos?: DtoMap;
  schemaExpanded?: boolean;
  onToggleSchema?: (nodeId: string) => void;
}

export interface PolicyFlowView {
  fromEvent: string | null;
  toCommand: string | null;
  invariant: string;
}

export interface PolicyNodeData extends Record<string, unknown> {
  label: string;
  flows: PolicyFlowView[];
}

export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  fullName: string;
  depth: number;
}

export interface LayoutOptions {
  tab: LayoutTab;
  /** Draw an edge from every event to a policy that listens to `DomainEvent`. */
  showWildcard: boolean;
  expandedSchemas: Set<string>;
  onToggleSchema: (nodeId: string) => void;
}

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
  width: number;
  height: number;
  stats: {
    commands: number;
    events: number;
    externalEvents: number;
    policies: number;
    queries: number;
    contexts: number;
  };
}

export const nodeId = {
  /** Actors are per bounded context, so the same principal can appear twice. */
  actor: (context: string, name: string) => `actor:${context}::${name}`,
  command: (name: string) => `command:${name}`,
  event: (name: string) => `event:${name}`,
  policy: (name: string) => `policy:${name}`,
  query: (name: string) => `query:${name}`,
  result: (name: string) => `result:${name}`,
  group: (name: string) => `group:${name}`,
};

export function parseNodeId(id: string): Selection | null {
  const [prefix, ...rest] = id.split(":");
  const raw = rest.join(":");
  const name = prefix === "actor" ? raw.split("::").pop() ?? "" : raw;
  if (!name) return null;
  switch (prefix) {
    case "actor":
    case "command":
    case "event":
    case "policy":
    case "query":
    case "result":
      return { kind: prefix, name };
    default:
      return null;
  }
}

/** Group box width: the event column plus its card, measured from the actor column. */
const GROUP_WIDTH = EVENT_X + NODE_WIDTH_PX - ACTOR_X + 2 * GROUP_PADDING;
const GROUP_X = ACTOR_X - GROUP_PADDING;
const REL_ACTOR_X = GROUP_PADDING;
const REL_COMMAND_X = COMMAND_X - ACTOR_X + GROUP_PADDING;
const REL_EVENT_X = EVENT_X - ACTOR_X + GROUP_PADDING;

// ── Height estimates (the DOM sizes the cards; these keep the gaps honest) ──

const LABEL_LINE = 20;
const SUMMARY_LINE = 24;
const HTTP_ROW = 26;
const SCHEMA_CHIP = 24;
const SCHEMA_LINE_HEIGHT = 17;
const CARD_PADDING = 20;

function lines(text: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

function labelHeight(input: {
  label: string;
  summary?: string;
  hasHttp?: boolean;
  payload?: FieldMap;
  dtos?: DtoMap;
  expanded: boolean;
  charsPerLine: number;
}): number {
  let height = CARD_PADDING + lines(input.label, input.charsPerLine) * LABEL_LINE;
  if (input.summary) height += SUMMARY_LINE;
  if (input.hasHttp) height += HTTP_ROW;
  const payloadLines = input.payload ? flattenSchema(input.payload, input.dtos).length : 0;
  if (payloadLines > 0) {
    height += SCHEMA_CHIP;
    if (input.expanded) height += 8 + payloadLines * SCHEMA_LINE_HEIGHT;
  }
  return height;
}

function commandHeight(command: CommandModel, dtos: DtoMap, expanded: boolean): number {
  return labelHeight({
    label: command.name,
    summary: command.summary,
    hasHttp: Boolean(command.httpMethod),
    payload: Object.keys(command.payload).length > 0 ? command.payload : undefined,
    dtos,
    expanded,
    charsPerLine: 40,
  });
}

function eventHeight(event: EventModel, dtos: DtoMap, expanded: boolean): number {
  return labelHeight({
    label: event.name,
    payload: Object.keys(event.payload).length > 0 ? event.payload : undefined,
    dtos,
    expanded,
    charsPerLine: 40,
  });
}

function queryLabelHeight(query: QueryModel, dtos: DtoMap, expanded: boolean): number {
  return labelHeight({
    label: query.name,
    summary: query.summary,
    hasHttp: Boolean(query.httpMethod),
    payload: Object.keys(query.payload).length > 0 ? query.payload : undefined,
    dtos,
    expanded,
    charsPerLine: 40,
  });
}

function actorHeight(name: string): number {
  return CARD_PADDING + lines(name, 12) * LABEL_LINE;
}

function policyHeight(policy: PolicyModel): number {
  // header (30px name + rule) + "Invariants" row + one block per flow.
  const flows = Math.max(1, policy.rules.length + policy.links.length);
  return 150 + flows * 96;
}

// ── Layout ─────────────────────────────────────────────────────────────────

export function buildLayout(graph: FlowGraph, options: LayoutOptions): LayoutResult {
  const { tab, expandedSchemas, onToggleSchema } = options;
  const dtos = tab === "queries" ? graph.queryDtos : graph.dtos;

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>();

  const isExpanded = (id: string) => expandedSchemas.has(id);

  const labelData = (input: {
    label: string;
    id: string;
    summary?: string;
    httpMethod?: string;
    path?: string;
    icon?: string;
    payload?: FieldMap;
  }): LabelNodeData => ({
    label: input.label,
    summary: input.summary,
    httpMethod: input.httpMethod,
    path: input.path,
    icon: input.icon,
    payload: input.payload,
    dtos,
    schemaExpanded: isExpanded(input.id),
    onToggleSchema,
  });

  let cursorY = 0;

  for (const context of graph.contexts) {
    const hasContent =
      tab === "queries"
        ? context.queries.length > 0
        : context.commands.length > 0 ||
          context.events.length > 0 ||
          context.policies.length > 0;
    if (!hasContent) continue;

    const groupId = nodeId.group(context.name);
    const groupY = cursorY;
    let innerY = groupY + GROUP_TOP_PADDING;

    if (tab === "commands") {
      for (const command of context.commands) {
        const id = nodeId.command(command.name);
        if (placed.has(id)) continue;

        const expanded = isExpanded(id);
        const height = commandHeight(command, graph.dtos, expanded);
        const relY = innerY - groupY;

        nodes.push({
          id,
          type: "labelNode",
          data: labelData({
            id,
            label: command.name,
            summary: command.summary,
            httpMethod: command.httpMethod,
            path: command.path,
            payload: Object.keys(command.payload).length > 0 ? command.payload : undefined,
          }),
          position: { x: REL_COMMAND_X, y: relY },
          parentId: groupId,
          style: { ...COMMAND_STYLE },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          draggable: true,
        });
        placed.set(id, { x: COMMAND_X, y: innerY, w: NODE_WIDTH_PX, h: height });

        // Events of this command stack to its right.
        let eventY = innerY;
        let rowBottom = innerY + height;
        command.emits.forEach((eventName) => {
          const event = graph.events.find((candidate) => candidate.name === eventName);
          if (!event) return;
          const eventId = nodeId.event(event.name);
          if (placed.has(eventId)) {
            rowBottom = Math.max(rowBottom, eventY);
            return;
          }
          const expandedEvent = isExpanded(eventId);
          const eHeight = eventHeight(event, graph.dtos, expandedEvent);
          nodes.push({
            id: eventId,
            type: "labelNode",
            data: labelData({
              id: eventId,
              label: event.name,
              payload: Object.keys(event.payload).length > 0 ? event.payload : undefined,
            }),
            position: { x: REL_EVENT_X, y: eventY - groupY },
            parentId: groupId,
            style: { ...EVENT_STYLE },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            draggable: true,
          });
          placed.set(eventId, { x: EVENT_X, y: eventY, w: NODE_WIDTH_PX, h: eHeight });
          eventY += Math.max(eHeight, 60) + (EVENT_STACK_GAP - 60);
          rowBottom = Math.max(rowBottom, eventY);
        });

        innerY = rowBottom + COMMAND_BLOCK_GAP;
      }

      // Events no command row here placed: external events, and events a
      // handler emits from another context.
      for (const event of context.events) {
        const eventId = nodeId.event(event.name);
        if (placed.has(eventId)) continue;
        const expandedEvent = isExpanded(eventId);
        const eHeight = eventHeight(event, graph.dtos, expandedEvent);
        nodes.push({
          id: eventId,
          type: "labelNode",
          data: labelData({
            id: eventId,
            label: event.name,
            payload: Object.keys(event.payload).length > 0 ? event.payload : undefined,
          }),
          position: { x: REL_EVENT_X, y: innerY - groupY },
          parentId: groupId,
          style: { ...EVENT_STYLE },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          draggable: true,
        });
        placed.set(eventId, { x: EVENT_X, y: innerY, w: NODE_WIDTH_PX, h: eHeight });
        innerY += Math.max(eHeight, 60) + (EVENT_STACK_GAP - 60);
      }

      // Actors, aligned with the first command each one starts.
      const actorFirstY = new Map<string, number>();
      for (const command of context.commands) {
        const rect = placed.get(nodeId.command(command.name));
        if (!rect) continue;
        for (const actor of command.actors) {
          const current = actorFirstY.get(actor);
          actorFirstY.set(actor, current === undefined ? rect.y : Math.min(current, rect.y));
        }
      }
      let actorY = groupY + GROUP_TOP_PADDING;
      for (const [actor, preferred] of [...actorFirstY].sort(
        (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
      )) {
        const y = Math.max(preferred, actorY);
        const id = nodeId.actor(context.name, actor);
        const height = actorHeight(actor);
        nodes.push({
          id,
          type: "labelNode",
          data: labelData({ id, label: actor, icon: "person" }),
          position: { x: REL_ACTOR_X, y: y - groupY },
          parentId: groupId,
          style: { ...ACTOR_STYLE },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          draggable: true,
        });
        placed.set(id, { x: ACTOR_X, y, w: ACTOR_NODE_WIDTH_PX, h: height });
        actorY = y + height + 24;
        innerY = Math.max(innerY, actorY);
      }
    } else {
      for (const query of context.queries) {
        const queryId = nodeId.query(query.name);
        if (placed.has(queryId)) continue;
        const expanded = isExpanded(queryId);
        const qHeight = queryLabelHeight(query, graph.queryDtos, expanded);
        const resultId = nodeId.result(query.name);
        const hasResult =
          Boolean(query.resultName) || Object.keys(query.resultPayload).length > 0;

        nodes.push({
          id: queryId,
          type: "labelNode",
          data: labelData({
            id: queryId,
            label: query.name,
            summary: query.summary,
            httpMethod: query.httpMethod,
            path: query.path,
            payload: Object.keys(query.payload).length > 0 ? query.payload : undefined,
          }),
          position: { x: REL_COMMAND_X, y: innerY - groupY },
          parentId: groupId,
          style: { ...COMMAND_STYLE },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          draggable: true,
        });
        placed.set(queryId, { x: COMMAND_X, y: innerY, w: NODE_WIDTH_PX, h: qHeight });

        let rHeight = qHeight;
        if (hasResult) {
          const expandedResult = isExpanded(resultId);
          rHeight = labelHeight({
            label: query.resultName || "Result",
            payload:
              Object.keys(query.resultPayload).length > 0 ? query.resultPayload : undefined,
            dtos: graph.queryDtos,
            expanded: expandedResult,
            charsPerLine: 40,
          });
          nodes.push({
            id: resultId,
            type: "labelNode",
            data: labelData({
              id: resultId,
              label: query.resultName || "Result",
              payload:
                Object.keys(query.resultPayload).length > 0
                  ? query.resultPayload
                  : undefined,
            }),
            position: { x: REL_EVENT_X, y: innerY - groupY },
            parentId: groupId,
            style: { ...RESULT_STYLE },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            draggable: true,
          });
          placed.set(resultId, { x: EVENT_X, y: innerY, w: NODE_WIDTH_PX, h: rHeight });
        }

        innerY += Math.max(qHeight, rHeight) + COMMAND_BLOCK_GAP;
      }

      const actorFirstY = new Map<string, number>();
      for (const query of context.queries) {
        const rect = placed.get(nodeId.query(query.name));
        if (!rect) continue;
        for (const actor of query.actors) {
          const current = actorFirstY.get(actor);
          actorFirstY.set(actor, current === undefined ? rect.y : Math.min(current, rect.y));
        }
      }
      let actorY = groupY + GROUP_TOP_PADDING;
      for (const [actor, preferred] of [...actorFirstY].sort(
        (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
      )) {
        const y = Math.max(preferred, actorY);
        const id = nodeId.actor(context.name, actor);
        const height = actorHeight(actor);
        nodes.push({
          id,
          type: "labelNode",
          data: labelData({ id, label: actor, icon: "person" }),
          position: { x: REL_ACTOR_X, y: y - groupY },
          parentId: groupId,
          style: { ...ACTOR_STYLE },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          draggable: true,
        });
        placed.set(id, { x: ACTOR_X, y, w: ACTOR_NODE_WIDTH_PX, h: height });
        actorY = y + height + 24;
        innerY = Math.max(innerY, actorY);
      }
    }

    const contentBottom = Math.max(innerY - COMMAND_BLOCK_GAP, groupY + GROUP_TOP_PADDING + 40);
    const groupHeight = contentBottom - groupY + GROUP_PADDING;

    // Groups first: React Flow needs a parent before its children.
    nodes.unshift({
      id: groupId,
      type: "groupNode",
      data: {
        label: context.label,
        fullName: context.name,
        depth: context.depth,
      } satisfies GroupNodeData,
      position: { x: GROUP_X, y: groupY },
      width: GROUP_WIDTH,
      height: groupHeight,
      draggable: true,
      selectable: true,
      focusable: true,
      zIndex: 0,
      style: { width: GROUP_WIDTH, height: groupHeight },
    });

    cursorY = groupY + groupHeight + CONTEXT_GAP;
  }

  // Policies sit in their own column, as in the reference (they are not part of
  // a context box because a policy can route across contexts).
  if (tab === "commands") {
    let policyY = 0;
    for (const policy of graph.policies) {
      const listenedEvents = policy.wildcard
        ? graph.events
        : graph.events.filter((event) => policy.listensTo.includes(event.name));
      const centres = listenedEvents
        .map((event) => placed.get(nodeId.event(event.name)))
        .filter((rect): rect is { x: number; y: number; w: number; h: number } => !!rect)
        .map((rect) => rect.y + rect.h / 2);
      const height = policyHeight(policy);
      const ideal =
        centres.length > 0
          ? centres.reduce((sum, centre) => sum + centre, 0) / centres.length - height / 2
          : policyY;
      const y = Math.max(0, ideal, policyY);
      nodes.push({
        id: nodeId.policy(policy.name),
        type: "policyNode",
        data: {
          label: policy.name,
          flows: policyFlows(policy),
        } satisfies PolicyNodeData,
        position: { x: POLICY_X, y },
        style: {},
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: true,
        zIndex: 2,
      });
      placed.set(nodeId.policy(policy.name), {
        x: POLICY_X,
        y,
        w: Number.parseInt(POLICY_NODE_WIDTH, 10),
        h: height,
      });
      policyY = y + height + VERTICAL_SPACING - 100;
    }
  }

  // ── Edges ────────────────────────────────────────────────────────────────
  const spreadArrows = (count: number, index: number) => (index - (count - 1) / 2) * 25;

  if (tab === "commands") {
    for (const command of graph.commands) {
      const commandPlacement = placed.get(nodeId.command(command.name));
      if (!commandPlacement) continue;

      const actors = [...new Set(command.actors)];
      actors.forEach((actor, index) => {
        const actorId = nodeId.actor(command.context, actor);
        if (!placed.has(actorId)) return;
        edges.push({
          id: `actor-${command.context}-${actor}-${command.name}`,
          source: actorId,
          target: nodeId.command(command.name),
          type: "spreadStep",
          data: { spread: spreadArrows(actors.length, index) },
          animated: false,
          style: { stroke: ACTOR_EDGE_COLOR, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: ACTOR_EDGE_COLOR },
        });
      });

      command.emits.forEach((eventName, index) => {
        if (!placed.has(nodeId.event(eventName))) return;
        edges.push({
          id: `command-${command.name}-${eventName}`,
          source: nodeId.command(command.name),
          target: nodeId.event(eventName),
          type: "spreadStep",
          data: { spread: spreadArrows(command.emits.length, index) },
          animated: true,
          style: { stroke: FLOW_EDGE_COLOR, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: FLOW_EDGE_COLOR },
        });
      });
    }

    for (const policy of graph.policies) {
      const policyPlacement = placed.get(nodeId.policy(policy.name));
      if (!policyPlacement) continue;

      const listens = policy.listensTo.filter((eventName) => eventName !== "DomainEvent");
      listens.forEach((eventName, index) => {
        if (!placed.has(nodeId.event(eventName))) return;
        edges.push({
          id: `event-${eventName}-policy-${policy.name}`,
          source: nodeId.event(eventName),
          target: nodeId.policy(policy.name),
          type: "spreadStep",
          data: { spread: spreadArrows(listens.length, index) },
          animated: true,
          style: { stroke: POLICY_EDGE_COLOR, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: POLICY_EDGE_COLOR },
        });
      });

      policy.sends.forEach((commandName, index) => {
        if (!placed.has(nodeId.command(commandName))) return;
        edges.push({
          id: `policy-${policy.name}-command-${commandName}`,
          source: nodeId.policy(policy.name),
          target: nodeId.command(commandName),
          type: "spreadStep",
          data: { spread: spreadArrows(policy.sends.length, index) },
          animated: true,
          style: { stroke: POLICY_EDGE_COLOR, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: POLICY_EDGE_COLOR },
        });
      });
    }

    if (options.showWildcard) {
      for (const policy of graph.policies.filter((candidate) => candidate.wildcard)) {
        if (!placed.has(nodeId.policy(policy.name))) continue;
        for (const event of graph.events) {
          if (!placed.has(nodeId.event(event.name))) continue;
          edges.push({
            id: `wildcard-${event.name}-${policy.name}`,
            source: nodeId.event(event.name),
            target: nodeId.policy(policy.name),
            type: "spreadStep",
            animated: false,
            style: {
              stroke: POLICY_EDGE_COLOR,
              strokeWidth: 1,
              strokeDasharray: "4 5",
              opacity: 0.55,
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: POLICY_EDGE_COLOR },
          });
        }
      }
    }
  } else {
    for (const query of graph.queries) {
      if (!placed.has(nodeId.query(query.name))) continue;
      const actors = [...new Set(query.actors)];
      actors.forEach((actor, index) => {
        const actorId = nodeId.actor(query.context, actor);
        if (!placed.has(actorId)) return;
        edges.push({
          id: `actor-${query.context}-${actor}-${query.name}`,
          source: actorId,
          target: nodeId.query(query.name),
          type: "spreadStep",
          data: { spread: spreadArrows(actors.length, index) },
          animated: false,
          style: { stroke: ACTOR_EDGE_COLOR, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: ACTOR_EDGE_COLOR },
        });
      });

      if (placed.has(nodeId.result(query.name))) {
        edges.push({
          id: `query-${query.name}-result`,
          source: nodeId.query(query.name),
          target: nodeId.result(query.name),
          type: "spreadStep",
          animated: true,
          style: { stroke: FLOW_EDGE_COLOR, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: FLOW_EDGE_COLOR },
        });
      }
    }
  }

  // Canvas extent, for fit-view and the mini-map.
  let width = GROUP_X + GROUP_WIDTH;
  let height = cursorY - CONTEXT_GAP;
  for (const rect of placed.values()) {
    width = Math.max(width, rect.x + rect.w);
    height = Math.max(height, rect.y + rect.h);
  }
  // Only reserve the policy column when the graph actually has policies.
  if (graph.policies.length > 0 && tab === "commands") {
    width = Math.max(width, POLICY_X + Number.parseInt(POLICY_NODE_WIDTH, 10));
  }
  width += GROUP_PADDING;

  return {
    nodes,
    edges,
    width,
    height: Math.max(height, 240),
    stats: {
      commands: graph.commands.length,
      events: graph.events.length,
      externalEvents: graph.events.filter((event) => event.external).length,
      policies: graph.policies.length,
      queries: graph.queries.length,
      contexts: graph.contexts.length,
    },
  };
}

/**
 * A policy card lists one block per invariant: the rule text, then the
 * event → command routing that rule justifies. Policies from the decorator
 * shape declare listeners/dispatches without rule text, so each of those pairs
 * becomes a block of its own.
 */
function policyFlows(policy: PolicyModel): PolicyFlowView[] {
  if (policy.links.length > 0) {
    return policy.links.map((link) => ({
      fromEvent: link.fromEvent,
      toCommand: link.toCommand,
      invariant: link.invariant ?? "",
    }));
  }
  if (policy.rules.length > 0) {
    return policy.rules.map((rule) => ({
      fromEvent: policy.listensTo.find((event) => event !== "DomainEvent") ?? null,
      toCommand: policy.sends[0] ?? null,
      invariant: rule,
    }));
  }
  return [
    {
      fromEvent: policy.listensTo.find((event) => event !== "DomainEvent") ?? null,
      toCommand: policy.sends[0] ?? null,
      invariant: policy.wildcard ? "Listens to every domain event." : "",
    },
  ];
}
