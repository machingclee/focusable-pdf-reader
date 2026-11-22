import type { Edge, Node } from "@xyflow/react";
import { parseNodeId, type Selection } from "./layout";

/**
 * Search and selection focus.
 *
 * Applied to the laid-out graph rather than inside the layout, for one concrete
 * reason: the nodes are draggable. Rebuilding the layout on a keystroke would
 * snap every card back to its computed position, so highlighting is a pure
 * transform over the current nodes and their user-set positions.
 */

export interface FocusOptions {
  search: string;
  selection: Selection | null;
}

export interface FocusedGraph {
  nodes: Node[];
  edges: Edge[];
  matches: string[];
}

const DIM_OPACITY = 0.22;
const MUTED_OPACITY = 0.55;
const DIM_EDGE_OPACITY = 0.1;

function haystack(node: Node): string {
  const data = node.data as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["label", "summary", "httpMethod", "path", "fullName"]) {
    const value = data[key];
    if (typeof value === "string") parts.push(value);
  }
  const flows = data.flows;
  if (Array.isArray(flows)) {
    for (const flow of flows) {
      const record = flow as { fromEvent?: string | null; toCommand?: string | null; invariant?: string };
      parts.push(record.fromEvent ?? "", record.toCommand ?? "", record.invariant ?? "");
    }
  }
  return parts.join(" ").toLowerCase();
}

export function focusGraph(
  nodes: Node[],
  edges: Edge[],
  options: FocusOptions,
): FocusedGraph {
  const query = options.search.trim().toLowerCase();
  if (!query && !options.selection) {
    return { nodes, edges, matches: [] };
  }

  const matched = new Set<string>();
  if (query) {
    for (const node of nodes) {
      if (node.type === "groupNode") continue;
      if (haystack(node).includes(query)) matched.add(node.id);
    }
  }

  const selected = new Set<string>();
  if (options.selection) {
    for (const node of nodes) {
      const parsed = parseNodeId(node.id);
      if (
        parsed &&
        parsed.kind === options.selection.kind &&
        parsed.name === options.selection.name
      ) {
        selected.add(node.id);
      }
    }
  }

  const focused = new Set<string>([...matched, ...selected]);
  for (const edge of edges) {
    if (matched.has(edge.source) || matched.has(edge.target) || selected.has(edge.source) || selected.has(edge.target)) {
      focused.add(edge.source);
      focused.add(edge.target);
    }
  }

  // A search narrows hard; a plain selection only softens the rest.
  const strict = query.length > 0;

  const nextNodes = nodes.map((node) => {
    if (node.type === "groupNode") return node;
    const isFocused = focused.has(node.id);
    const isSelected = selected.has(node.id);
    const opacity = isFocused ? 1 : strict ? DIM_OPACITY : MUTED_OPACITY;
    return {
      ...node,
      zIndex: isSelected ? 5 : node.zIndex,
      style: {
        ...node.style,
        opacity,
        ...(isSelected ? { outline: "3px solid rgba(14,165,233,0.9)", outlineOffset: "1px" } : {}),
      },
    } as Node;
  });

  const nextEdges = edges.map((edge) => ({
    ...edge,
    style: {
      ...edge.style,
      opacity:
        focused.has(edge.source) && focused.has(edge.target)
          ? edge.style?.opacity ?? 1
          : DIM_EDGE_OPACITY,
    },
  }));

  return { nodes: nextNodes, edges: nextEdges, matches: [...matched] };
}
